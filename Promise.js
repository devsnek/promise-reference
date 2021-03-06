'use strict';

const kPromiseState = Symbol('[[PromiseState]]');
const kPromiseFulfillReactions = Symbol('[[PromiseFulfillReactions]]');
const kPromiseRejectReactions = Symbol('[[PromiseRejectReactions]]');
const kPromiseIsHandled = Symbol('[[PromiseIsHandled]]');
const kPromiseResult = Symbol('[[PromiseResult]]');
const kPromise = Symbol('[[Promise]]');
const kResolve = Symbol('[[Resolve]]');
const kReject = Symbol('[[Reject]]');
const kCapability = Symbol('[[Capability]]');
const kType = Symbol('[[Type]]');
const kHandler = Symbol('[[Handler]]');
const kIterator = Symbol('[[Iterator]]');
const kNextMethod = Symbol('[[NextMethod]]');
const kDone = Symbol('[[Done]]');

// https://tc39.github.io/ecma262/#sec-ecmascript-data-types-and-values
function Type(x) {
  if (x === null) {
    return 'Null';
  }
  if (typeof x === 'symbol') {
    return 'Symbol';
  }
  if (typeof x === 'undefined') {
    return 'Undefined';
  }
  if (typeof x === 'function' || typeof x === 'object') {
    return 'Object';
  }
  if (typeof x === 'number') {
    return 'Number';
  }
  if (typeof x === 'boolean') {
    return 'Boolean';
  }
  if (typeof x === 'string') {
    return 'String';
  }
}

// https://tc39.github.io/ecma262/#sec-getprototypefromconstructor
function GetPrototypeFromConstructor(constructor, intrinsicDefaultProto) {
  const proto = constructor.prototype;
  if (Type(proto) !== 'Object') {
    // This is explicitly incorrect. When looking up the intrinsic here it
    // should use the realm environment for `constructor` but there's no way to
    // polyfill that.
    if (intrinsicDefaultProto === '%PromisePrototype%') {
      return Promise.prototype; // eslint-disable-line no-use-before-define
    }
  }
  return proto;
}

// https://tc39.github.io/ecma262/#sec-ordinarycreatefromconstructor
function OrdinaryCreateFromConstructor(constructor, intrinsicDefaultProto, internalSlotsList) {
  const proto = GetPrototypeFromConstructor(constructor, intrinsicDefaultProto);
  const i = {};
  internalSlotsList.forEach((s) => {
    i[s] = {
      value: undefined,
      enumerable: false,
      configurable: false,
      writable: true,
    };
  });
  return Object.create(proto, i);
}

// https://tc39.github.io/ecma262/#sec-getiterator
function GetIterator(obj, hint, method) {
  if (method === undefined) {
    method = obj[Symbol.iterator];
  }

  const iterator = method.call(obj);
  if (Type(iterator) !== 'Object') {
    throw new TypeError();
  }

  const nextMethod = iterator.next;

  const iteratorRecord = {
    [kIterator]: iterator,
    [kNextMethod]: nextMethod,
    [kDone]: false,
  };

  return iteratorRecord;
}

// https://tc39.github.io/ecma262/#sec-iteratorclose
function IteratorClose(iteratorRecord, completion) {
  const iterator = iteratorRecord[kIterator];
  const $return = iterator.return;
  if ($return === undefined) {
    throw completion;
  }

  let innerResult;
  try {
    innerResult = $return.call(iterator);
  } catch (e) {
    innerResult = e;
    throw innerResult;
  }
}

// https://tc39.github.io/ecma262/#sec-iteratornext
function IteratorNext(iteratorRecord, value) {
  const result = iteratorRecord[kNextMethod].call(iteratorRecord[kIterator], value);
  if (Type(result) !== 'Object') {
    throw new TypeError();
  }
  return result;
}

// https://tc39.github.io/ecma262/#sec-iteratorcomplete
function IteratorComplete(iterResult) {
  return iterResult.done;
}

// https://tc39.github.io/ecma262/#sec-iteratorstep
function IteratorStep(iteratorRecord) {
  const result = IteratorNext(iteratorRecord);
  const done = IteratorComplete(result);
  if (done === true) {
    return false;
  }
  return result;
}

// https://tc39.github.io/ecma262/#sec-iteratorvalue
function IteratorValue(iterResult) {
  return iterResult.value;
}

// https://tc39.github.io/ecma262/#sec-speciesconstructor
function SpeciesConstructor(O, defaultConstructor) {
  const C = O.constructor;
  if (C === undefined) {
    return defaultConstructor;
  }
  if (Type(C) !== 'Object') {
    throw new TypeError();
  }
  const S = C[Symbol.species];
  if (S === undefined || S === null) {
    return defaultConstructor;
  }
  if (typeof S === 'function') {
    return S;
  }
  throw new TypeError();
}

// https://tc39.github.io/ecma262/#sec-list-and-record-specification-type
// Operate on an ordered list without triggering array prototype shenanigans
function List() {
  return Reflect.construct(Array, [], List);
}
List[Symbol.species] = List;
List.prototype = {
  push: Array.prototype.push,
  shift: Array.prototype.shift,
  forEach: Array.prototype.forEach,
  constructor: List,
  __proto__: null,
};

function CreateArrayFromList(list) {
  return Array.from(list);
}

// https://tc39.github.io/ecma262/#sec-enqueuejob
let EnqueueJob;
{
  let schedule;
  const queue = new List();
  let queued = false;
  const global = (0, eval('this')); // eslint-disable-line no-eval

  if (typeof global.queueMicrotask === 'function') {
    // queueMicrotask exists in recent browsers and Node.js,
    // and is functionally identical to EnqueueJob
    schedule = global.queueMicrotask;
  } else if (typeof global.Promise !== 'undefined'
      && Object.prototype.toString.call(new global.Promise(() => {})) === '[object Promise]') {
    // If the real Promise exists, we can use that
    const p = global.Promise.resolve();
    schedule = (f) => {
      p.then(f);
    };
  } else if (typeof setImmediate === 'function') {
    // setImmediate is faster than setTimeout, but not everything has it
    schedule = setImmediate;
  } else {
    // safe fallback
    schedule = (f) => setTimeout(f, 0);
  }

  EnqueueJob = (queueName, job, args) => {
    if (queueName !== 'PromiseJobs') {
      throw new TypeError();
    }

    queue.push(job.bind(undefined, ...args));

    if (queued === false) {
      queued = true;
      schedule(() => {
        while (queue.length > 0) {
          queue.shift()();
        }
        queued = false;
      });
    }
  };
}

// https://tc39.github.io/ecma262/#sec-host-promise-rejection-tracker
function HostPromiseRejectionTracker(promise, operation) {} // eslint-disable-line no-unused-vars

// https://tc39.github.io/ecma262/#sec-promisereactionjob
function PromiseReactionJob(reaction, argument) {
  const promiseCapability = reaction[kCapability];
  const type = reaction[kType];
  const handler = reaction[kHandler];

  let handlerResult;

  let abruptCompletion = false;
  if (handler === undefined) {
    if (type === 'Fulfill') {
      handlerResult = argument;
    } else {
      handlerResult = argument;
      abruptCompletion = true;
    }
  } else {
    try {
      handlerResult = handler(argument);
    } catch (e) {
      handlerResult = e;
      abruptCompletion = true;
    }
  }

  let status;
  if (abruptCompletion) {
    status = promiseCapability[kReject].call(undefined, handlerResult);
  } else {
    status = promiseCapability[kResolve].call(undefined, handlerResult);
  }

  return status;
}

// https://tc39.github.io/ecma262/#sec-promiseresolvethenablejob
function PromiseResolveThenableJob(promiseToResolve, thenable, then) {
  // eslint-disable-next-line no-use-before-define
  const resolvingFunctions = CreateResolvingFunctions(promiseToResolve);

  try {
    const thenCallResult = then.call(
      thenable, resolvingFunctions[kResolve], resolvingFunctions[kReject],
    );
    return thenCallResult;
  } catch (thenCallResult) {
    const status = resolvingFunctions[kReject].call(undefined, thenCallResult);
    return status;
  }
}

// https://tc39.github.io/ecma262/#sec-newpromisecapability
function NewPromiseCapability(C) {
  const promiseCapability = {
    [kPromise]: undefined,
    [kResolve]: undefined,
    [kReject]: undefined,
  };

  const promise = new C((resolve, reject) => {
    // GetCapabilitiesExecutor
    if (promiseCapability[kResolve] !== undefined
        || promiseCapability[kReject] !== undefined) {
      throw new TypeError();
    }
    promiseCapability[kResolve] = resolve;
    promiseCapability[kReject] = reject;
  });

  if (typeof promiseCapability[kResolve] !== 'function') {
    throw new TypeError();
  }

  if (typeof promiseCapability[kReject] !== 'function') {
    throw new TypeError();
  }

  promiseCapability[kPromise] = promise;

  return promiseCapability;
}

// https://tc39.github.io/ecma262/#sec-triggerpromisereactions
function TriggerPromiseReactions(reactions, argument) {
  reactions.forEach((reaction) => {
    EnqueueJob('PromiseJobs', PromiseReactionJob, [reaction, argument]);
  });
  return undefined;
}

// https://tc39.github.io/ecma262/#sec-fulfillpromise
function FulfillPromise(promise, value) {
  const reactions = promise[kPromiseFulfillReactions];
  promise[kPromiseResult] = value;
  promise[kPromiseFulfillReactions] = undefined;
  promise[kPromiseRejectReactions] = undefined;
  promise[kPromiseState] = 'fulfilled';
  return TriggerPromiseReactions(reactions, value);
}

// https://tc39.github.io/ecma262/#sec-rejectpromise
function RejectPromise(promise, reason) {
  const reactions = promise[kPromiseRejectReactions];
  promise[kPromiseResult] = reason;
  promise[kPromiseFulfillReactions] = undefined;
  promise[kPromiseRejectReactions] = undefined;
  promise[kPromiseState] = 'rejected';
  if (promise[kPromiseIsHandled] === false) {
    HostPromiseRejectionTracker(promise, 'reject');
  }
  return TriggerPromiseReactions(reactions, reason);
}

const hasOwnProperty = Function.call.bind(Object.prototype.hasOwnProperty);

// https://tc39.github.io/ecma262/#sec-ispromise
function IsPromise(x) {
  if (Type(x) !== 'Object') {
    return false;
  }

  if (!hasOwnProperty(x, kPromiseState)) {
    return false;
  }

  return true;
}

// https://tc39.github.io/ecma262/#sec-promiseresolve
function PromiseResolve(C, x) {
  if (IsPromise(x)) {
    const xConstructor = x.constructor;
    if (C === xConstructor) {
      return x;
    }
  }
  const promiseCapability = NewPromiseCapability(C);
  promiseCapability[kResolve].call(undefined, x);
  return promiseCapability[kPromise];
}

// https://tc39.github.io/ecma262/#sec-performpromisethen
function PerformPromiseThen(promise, onFulfilled, onRejected, resultCapability) {
  if (typeof onFulfilled !== 'function') {
    onFulfilled = undefined;
  }
  if (typeof onRejected !== 'function') {
    onRejected = undefined;
  }

  const fulfillReaction = {
    [kCapability]: resultCapability,
    [kType]: 'Fulfill',
    [kHandler]: onFulfilled,
  };

  const rejectReaction = {
    [kCapability]: resultCapability,
    [kType]: 'Reject',
    [kHandler]: onRejected,
  };

  if (promise[kPromiseState] === 'pending') {
    promise[kPromiseFulfillReactions].push(fulfillReaction);
    promise[kPromiseRejectReactions].push(rejectReaction);
  } else if (promise[kPromiseState] === 'fulfilled') {
    const value = promise[kPromiseResult];
    EnqueueJob('PromiseJobs', PromiseReactionJob, [fulfillReaction, value]);
  } else {
    const reason = promise[kPromiseResult];
    HostPromiseRejectionTracker(promise, 'handle');
    EnqueueJob('PromiseJobs', PromiseReactionJob, [rejectReaction, reason]);
  }

  promise[kPromiseIsHandled] = true;
  return resultCapability[kPromise];
}

// https://tc39.github.io/ecma262/#sec-createresolvingfunctions
function CreateResolvingFunctions(promise) {
  let alreadyResolved = false;

  const resolve = (0, (resolution) => {
    if (alreadyResolved) {
      return undefined;
    }
    alreadyResolved = true;

    if (resolution === promise) {
      const selfResolutionError = new TypeError('cannot reject a promise with itself');
      return RejectPromise(promise, selfResolutionError);
    }
    if (Type(resolution) !== 'Object') {
      return FulfillPromise(promise, resolution);
    }

    let then;
    try {
      then = resolution.then; // eslint-disable-line prefer-destructuring
    } catch (err) {
      return RejectPromise(promise, err);
    }

    if (typeof then !== 'function') {
      return FulfillPromise(promise, resolution);
    }

    const thenAction = then;
    EnqueueJob('PromiseJobs', PromiseResolveThenableJob, [promise, resolution, thenAction]);

    return undefined;
  });

  const reject = (0, (reason) => {
    if (alreadyResolved === true) {
      return undefined;
    }
    alreadyResolved = true;

    return RejectPromise(promise, reason);
  });

  return {
    [kResolve]: resolve,
    [kReject]: reject,
  };
}

// https://tc39.github.io/ecma262/#sec-performpromiseall
function PerformPromiseAll(iteratorRecord, constructor, resultCapability) {
  const values = new List();
  let remainingElementsCount = 1;
  let index = 0;

  while (true) { // eslint-disable-line no-constant-condition
    let next;
    try {
      next = IteratorStep(iteratorRecord);
    } catch (e) {
      iteratorRecord[kDone] = true;
      throw e;
    }

    if (next === false) {
      iteratorRecord[kDone] = true;
      remainingElementsCount -= 1;

      if (remainingElementsCount === 0) {
        const valuesArray = CreateArrayFromList(values);
        resultCapability[kResolve].call(undefined, valuesArray);
      }

      return resultCapability[kPromise];
    }

    let nextValue;
    try {
      nextValue = IteratorValue(next);
    } catch (e) {
      iteratorRecord[kDone] = true;
      throw e;
    }

    values.push(undefined);
    const nextPromise = constructor.resolve(nextValue);

    const thisIndex = index;
    let alreadyCalled = false;
    const resolveElement = (0, (x) => { // eslint-disable-line no-loop-func
      if (alreadyCalled) {
        return undefined;
      }
      alreadyCalled = true;

      Object.defineProperty(values, thisIndex, {
        value: x,
        enumerable: true,
        configurable: true,
        writable: true,
      });

      remainingElementsCount -= 1;
      if (remainingElementsCount === 0) {
        const valuesArray = CreateArrayFromList(values);
        resultCapability[kResolve].call(undefined, valuesArray);
      }

      return undefined;
    });

    remainingElementsCount += 1;

    nextPromise.then(resolveElement, resultCapability[kReject]);

    index += 1;
  }
}

// https://tc39.github.io/ecma262/#sec-performpromiserace
function PerformPromiseRace(iteratorRecord, constructor, resultCapability) {
  while (true) { // eslint-disable-line no-constant-condition
    let next;
    try {
      next = IteratorStep(iteratorRecord);
    } catch (e) {
      iteratorRecord[kDone] = true;
      throw e;
    }

    if (next === false) {
      iteratorRecord[kDone] = true;
      return resultCapability[kPromise];
    }

    let nextValue;
    try {
      nextValue = IteratorValue(next);
    } catch (e) {
      iteratorRecord[kDone] = true;
      throw e;
    }

    const nextPromise = constructor.resolve(nextValue);
    nextPromise.then(resultCapability[kResolve], resultCapability[kReject]);
  }
}

// https://tc39.github.io/ecma262/#sec-promise-objects
class Promise {
  // https://tc39.github.io/ecma262/#sec-promise.all
  static all(iterable) {
    const C = this;
    if (Type(C) !== 'Object') {
      throw new TypeError();
    }

    const promiseCapability = NewPromiseCapability(C);

    let iteratorRecord;
    try {
      iteratorRecord = GetIterator(iterable);
    } catch (e) {
      iteratorRecord = e;

      promiseCapability[kReject].call(undefined, iteratorRecord);

      return promiseCapability[kPromise];
    }

    let result;
    try {
      result = PerformPromiseAll(iteratorRecord, C, promiseCapability);
    } catch (e) {
      result = e;
      if (iteratorRecord[kDone] === false) {
        try {
          IteratorClose(iteratorRecord, result);
        } catch (ee) {
          result = ee;
        }
      }

      promiseCapability[kReject].call(undefined, result);

      return promiseCapability[kPromise];
    }

    return result;
  }

  // https://tc39.github.io/ecma262/#sec-promise.race
  static race(iterable) {
    const C = this;
    if (Type(C) !== 'Object') {
      throw new TypeError();
    }

    const promiseCapability = NewPromiseCapability(C);

    let iteratorRecord;
    try {
      iteratorRecord = GetIterator(iterable);
    } catch (e) {
      iteratorRecord = e;

      promiseCapability[kReject].call(undefined, iteratorRecord);

      return promiseCapability[kPromise];
    }

    let result;
    try {
      result = PerformPromiseRace(iteratorRecord, C, promiseCapability);
    } catch (e) {
      result = e;

      if (iteratorRecord[kDone] === false) {
        try {
          IteratorClose(iteratorRecord, result);
        } catch (ee) {
          result = ee;
        }
      }
      promiseCapability[kReject].call(undefined, result);

      return promiseCapability[kPromise];
    }

    return result;
  }

  // https://tc39.github.io/ecma262/#sec-promise.reject
  static reject(r) {
    const C = this;
    if (Type(C) !== 'Object') {
      throw new TypeError();
    }
    const promiseCapability = NewPromiseCapability(C);
    promiseCapability[kReject].call(undefined, r);
    return promiseCapability[kPromise];
  }

  // https://tc39.github.io/ecma262/#sec-promise.resolve
  static resolve(x) {
    const C = this;
    if (Type(C) !== 'Object') {
      throw new TypeError();
    }
    return PromiseResolve(C, x);
  }

  // https://tc39.github.io/ecma262/#sec-get-promise-@@species
  static get [Symbol.species]() {
    return this;
  }

  // https://tc39.github.io/ecma262/#sec-promise-executor
  constructor(executor) {
    if (typeof executor !== 'function') {
      throw new TypeError();
    }

    const promise = OrdinaryCreateFromConstructor(new.target, '%PromisePrototype%', [
      // https://tc39.github.io/ecma262/#sec-properties-of-promise-instances
      kPromiseState,
      kPromiseFulfillReactions,
      kPromiseRejectReactions,
      kPromiseIsHandled,
      kPromiseResult,
    ]);

    promise[kPromiseState] = 'pending';
    promise[kPromiseFulfillReactions] = new List();
    promise[kPromiseRejectReactions] = new List();
    promise[kPromiseIsHandled] = false;

    const resolvingFunctions = CreateResolvingFunctions(promise);

    try {
      executor.call(undefined, resolvingFunctions[kResolve], resolvingFunctions[kReject]);
    } catch (err) {
      resolvingFunctions[kReject].call(undefined, err);
    }

    return promise;
  }

  // https://tc39.github.io/ecma262/#sec-promise.prototype.catch
  catch(onRejected) {
    const promise = this;
    return promise.then(undefined, onRejected);
  }

  // https://tc39.github.io/ecma262/#sec-promise.prototype.finally
  finally(onFinally) {
    const promise = this;

    if (Type(promise) !== 'Object') {
      throw new TypeError();
    }

    const C = SpeciesConstructor(promise, Promise);

    let thenFinally;
    let catchFinally;
    if (typeof onFinally !== 'function') {
      thenFinally = onFinally;
      catchFinally = onFinally;
    } else {
      thenFinally = (0, (value) => {
        const result = onFinally();
        const p = PromiseResolve(C, result);
        const valueThunk = () => value;
        return p.then(valueThunk);
      });
      catchFinally = (0, (reason) => {
        const result = onFinally();
        const p = PromiseResolve(C, result);
        const thrower = () => {
          throw reason;
        };
        return p.then(thrower);
      });
    }

    return promise.then(thenFinally, catchFinally);
  }

  // https://tc39.github.io/ecma262/#sec-promise.prototype.then
  then(onFulfilled, onRejected) {
    const promise = this;
    if (!IsPromise(promise)) {
      throw new TypeError();
    }
    const C = SpeciesConstructor(promise, Promise);
    const resultCapability = NewPromiseCapability(C);
    return PerformPromiseThen(promise, onFulfilled, onRejected, resultCapability);
  }
}

// https://tc39.github.io/ecma262/#sec-promise.prototype-@@tostringtag
Object.defineProperty(Promise.prototype, Symbol.toStringTag, {
  value: 'Promise',
  enumerable: false,
  configurable: true,
  writable: false,
});

module.exports = Promise;
