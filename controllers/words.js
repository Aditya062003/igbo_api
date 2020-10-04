import { keys, reduce, map } from 'lodash';
import removePrefix from '../shared/utils/removePrefix';
import Word from '../models/Word';
import { findSearchWord } from '../services/words';
import { NO_PROVIDED_TERM } from '../utils/constants/errorMessages';
import diacriticCodes from '../shared/constants/diacriticCodes';
import { getDocumentsIds } from '../shared/utils/documentUtils';
import { createPhrase } from './phrases';
import { createExample } from './examples';

const WORD_POPULATE = {
    path: 'phrases',
    populate: {
        path: 'examples',
        model: 'Example',
    }
};

export const createRegExp = (searchWord) => {
    /* front and back ensure the regexp will match with whole words */
    const front = '(?:^|[^a-zA-Z\u00c0-\u1ee5])';
    const back = '(?![a-zA-Z\u00c0-\u1ee5]+|,|s[a-zA-Z\u00c0-\u1ee5]+)';
    const regexWordString = [...searchWord].reduce((regexWord, letter) => {
        return `${regexWord}${diacriticCodes[letter] || letter}`;
    }, '');
    return new RegExp(`${front}${regexWordString}${back}`);
};

/* Gets words from JSON dictionary */
export const getWordData = (_, res) => {
    const { req: { query }} = res;
    const searchWord = removePrefix(query.keyword);
    if (!searchWord) {
        res.status(400);
        res.send(NO_PROVIDED_TERM);
    }
    const regexWord = createRegExp(searchWord);
    return res.send(findSearchWord(regexWord, searchWord));
};

/* Searches for a word with Igbo stored in MongoDB */
export const searchWordWithIgbo = (keyword) => {
    const regex = !keyword ? /./ : createRegExp(keyword);
    return Word
        .find({ $or: [{ word: { $regex: regex } }, { variations: { $in: [regex] } }] })
        .populate(WORD_POPULATE);
};

/* Searches for word with English stored in MongoDB */
export const searchWordWithEnglish = (keyword) => {
    const regex = !keyword ? /./ : createRegExp(keyword);
    return Word
        .find({ definitions: { $in : [regex] } })
        .populate(WORD_POPULATE);
};

/* Gets words from MongoDB */
export const getWords = async (_, res) => {
    const { req: { query }} = res;
    const searchWord = removePrefix(query.keyword || '');
    const words = await searchWordWithIgbo(searchWord);
    if (!words.length) {
        return res.send(await searchWordWithEnglish(searchWord));
    }
    return res.send(words);
};

/* Creates Word documents in MongoDB database */
export const createWord = async (data) => {
    const { examples, word, wordClass, definitions, variations } = data;
    const wordData = {
        word,
        wordClass,
        definitions,
        variations,
    };
    const newWord = new Word(wordData);
    await newWord.save();
    
    /* Go through each word's phrase and create a Phrase document */
    const phrases = keys(data.phrases);
    const savedPhrases = reduce(phrases, (phrasePromises, phrase) => {
        const phraseInfo = data.phrases[phrase];
        phraseInfo.phrase = phrase;
        phraseInfo.word = newWord.id;
        phrasePromises.push(createPhrase(phraseInfo));
        return phrasePromises;
    }, []);

    /* Go through each word's example and create an Example document */
    const savedExamples = map(examples, async (example) => {
        const exampleData = {
            example,
            parentWord: newWord.id,
        };
        return createExample(exampleData);
    });
    
    /* Wait for all the Phrases and Examples to be created and then add them to the Word document */
    const resolvedPhrases = await Promise.all(savedPhrases);
    const resolvedExamples = await Promise.all(savedExamples);
    const phraseIds = getDocumentsIds(resolvedPhrases);
    const exampleIds = getDocumentsIds(resolvedExamples);
    newWord.phrases = phraseIds;
    newWord.examples = exampleIds;
    return newWord.save();
};