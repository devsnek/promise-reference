# Promise Reference Implementation

Reference implementation of ECMA-262 Promises, in JavaScript.

---

This tries to stick as close as possible to the spec text but some things
cannot be done with JavaScript...

### 1. CreateBuiltinFunction

When the spec wants us to create a function from some algorithm steps,
instead we simply define an anonymous function with the steps.

[Example](https://tc39.github.io/ecma262/#sec-promise-resolve-functions)

Solution:

```js
let alreadyResolved = false;
const resolve = (0, (resolution) => {
  if (alreadyResolved) {
    return;
  }

  // ...
});
```


### 2. Completions

The spec really wants JavaScript to be a language where people use monads
instead of exceptions. Unfortunately we can't really recreate this. Instead, we
simply pull the completion out via a try-catch block.

[Example](https://tc39.github.io/ecma262/#sec-promise.all)

Solution:

```js
// Let iteratorRecord be GetIterator(iterable).
// IfAbruptRejectPromise(iteratorRecord, promiseCapability).

// becomes:

let iteratorRecord;
try {
  iteratorRecord = GetIterator(iterable);
} catch (e) {
  iteratorRecord = e; // if iteratorRecord is an abrupt completion...

  // IfAbruptRejectPromise(iteratorRecord, promiseCapability)
  promiseCapability[kReject].call(undefined, iteratorRecord);
  return promiseCapability[kPromise];
}
```
