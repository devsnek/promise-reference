'use strict';

/* eslint-disable no-console */

const vm = require('vm');
const fs = require('fs');
const glob = require('glob').sync;
const yaml = require('js-yaml').load;

const promiseSource = fs.readFileSync('./Promise.js', 'utf8');

function createRealm(print) {
  const context = vm.createContext({ print, setImmediate });

  context.$262 = {
    createRealm: () => createRealm(print),
    detachArrayBuffer() {},
    evalScript(s, file) {
      if (file === true) {
        s = fs.readFileSync(s, 'utf8');
      }
      vm.runInContext(s, context);
    },
    global: vm.runInContext('this', context),
    agent: {},
  };

  context.$262.evalScript(`
(() => {
const module = { exports: {} };
${promiseSource}
this.Promise = module.exports;
})();
`);

  return context.$262;
}

function run(test, strict) {
  return new Promise((resolve, reject) => {
    let options = { description: test };

    const { evalScript } = createRealm((m) => {
      if (m === 'Test262:AsyncTestComplete') {
        resolve(options);
      } else {
        reject(m);
      }
    });

    evalScript('./test262/harness/assert.js', true);
    evalScript('./test262/harness/sta.js', true);

    const source = fs.readFileSync(test, 'utf8');

    const yamls = /\/\*---\n((.|\n)+?)\n---\*\//.exec(source)[1];
    options = yaml(yamls);

    if (options.includes) {
      options.includes.forEach((n) => {
        evalScript(`./test262/harness/${n}`, true);
      });
    }

    let sync = true;
    if (options.flags) {
      if (options.flags.includes('async')) {
        evalScript('./test262/harness/doneprintHandle.js', true);
        sync = false;
      }
      if (strict && options.flags.includes('noStrict')) {
        resolve(options);
        return;
      }

      if (!strict && options.flags.includes('onlyStrict')) {
        resolve(options);
        return;
      }
    }

    try {
      evalScript(strict ? `"use strict";\n${source}` : source);
      if (sync) {
        resolve(options);
      }
    } catch (err) {
      if (options.negative) {
        resolve(options);
      } else {
        reject(err);
      }
    }
  });
}

const tests = glob('./test262/test/built-ins/Promise/**/*.js');

const skip = [
  // I think to make this one pass I have to make sure all
  // Promise constructors share the same prototype across realms,
  // and I have no way to assure that.
  './test262/test/built-ins/Promise/proto-from-ctor-realm.js',

  // Simply impossible. I have to use arrays.
  './test262/test/built-ins/Promise/all/does-not-invoke-array-setters.js',

  // The next 4 will not pass in any engine. They assume that anonymous
  // functions do not have an own `name` property.
  './test262/test/built-ins/Promise/executor-function-name.js',
  './test262/test/built-ins/Promise/reject-function-name.js',
  './test262/test/built-ins/Promise/resolve-function-name.js',
  './test262/test/built-ins/Promise/all/resolve-element-function-name.js',
];

let passed = 0;
let skipped = 0;
let failed = 0;
const promises = tests.map(async (t) => {
  const short = t.replace('./test262/test/built-ins/', '');

  if (skip.includes(t)) {
    console.log('\u001b[33mSKIP\u001b[39m', short);
    skipped += 1;
    return;
  }

  try {
    const { description } = await run(t, false);
    console.log('\u001b[32mPASS\u001b[39m [SLOPPY]', description.trim());
  } catch (e) {
    console.error('\u001b[31mFAIL\u001b[39m [SLOPPY]', short, e);
    failed += 1;
    return;
  }

  try {
    const { description } = await run(t, true);
    console.log('\u001b[32mPASS\u001b[39m [STRICT]', description.trim());
  } catch (e) {
    console.error('\u001b[31mFAIL\u001b[39m [STRICT]', short, e);
    failed += 1;
    return;
  }

  passed += 1;
});

Promise.all(promises)
  .then((x) => {
    console.table({ passed, failed, skipped, total: x.length });
    if (failed > 0) {
      process.exit(1);
    }
  });
