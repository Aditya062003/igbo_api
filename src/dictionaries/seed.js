import mongoose from 'mongoose';
import { map, flatten, keys } from 'lodash';
import { createWord } from '../controllers/words';
import dictionary from './ig-en/ig-en.json';
import { MONGO_URI } from '../config';
import Dialects from '../shared/constants/Dialects';
import WordClass from '../shared/constants/WordClass';

const WRITE_DB_DELAY = 15000;

const populate = async () => {
  /* This route will populate a local MongoDB database */
  if (process.env.NODE_ENV !== 'production') {
    console.blue('🌱 Seeding database...');
    mongoose.connection.db.dropDatabase();
    const wordPromises = flatten(
      map(keys(dictionary), (key) => {
        const value = dictionary[key];
        return map(value, (term) => {
          const word = { ...term };
          const cleanedKey = key.replace(/\./g, '');
          word.word = key;
          word.definitions = [
            {
              wordClass: word.wordClass || WordClass.NNC.value,
              definitions: word.definitions,
            },
          ];
          word.dialects = {
            [`${cleanedKey}-dialect`]: {
              dialects: [Dialects.NSA.value],
              variations: [],
              pronunciation: '',
            },
          };
          return createWord(word);
        });
      }),
    );
    /* Waits for all the MongoDB document save promises to resolve */
    const savedWords = await Promise.all(wordPromises)
      .then(async () => {
        /* Wait 15 seconds to allow the data to be written to database */
        await new Promise((resolve) => setTimeout(() => {
          console.green('✅ Seeding successful');
          if (process.env.NODE_ENV === 'production') {
            resolve();
            process.exit(0);
          } else {
            resolve();
          }
        }, WRITE_DB_DELAY));
      })
      .catch((err) => {
        console.red('🔴 Seeding failed', err);
      });
    return savedWords;
  }
  return Promise.resolve();
};

const seed = () => {
  if (mongoose.connection.readyState !== 1) {
    mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
    });
    const db = mongoose.connection;
    db.on('error', console.error.bind(console, 'connection error:'));
    return new Promise((resolve) => db.once('open', async () => {
      console.green('🗄 Database is connected');
      await populate();
      return resolve();
    }));
  }
  return populate();
};

const sendResponseAndEndServer = (res) => {
  res.redirect('/');
  return setTimeout(() => {
    console.log('💡 Restarting the server');
    return process.exit(0);
  }, 2000);
};

export const seedDatabase = async (_, res, next) => {
  try {
    await seed();
    /* Ends the docker container to restart. Necessary for
     * Text Indexes to be created for testing purposes */
    if (process.env.CONTAINER_HOST === 'mongodb') {
      return sendResponseAndEndServer(res);
    }
    return res.redirect('/');
  } catch (err) {
    return next(new Error('An error occurred during seeding'));
  }
};
