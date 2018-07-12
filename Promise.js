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

function Type(x) {
  if (typeof x === 'symbol') {
    return 'Symbol';
  }
  if (x === null) {
    return 'Null';
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

function IteratorNext(iteratorRecord, value) {
  const result = iteratorRecord[kNextMethod].call(iteratorRecord[kIterator], value);
  if (Type(result) !== 'Object') {
    throw new TypeError();
  }
  return result;
}

function IteratorComplete(iterResult) {
  return iterResult.done;
}

function IteratorStep(iteratorRecord) {
  const result = IteratorNext(iteratorRecord);
  const done = IteratorComplete(result);
  if (done === true) {
    return false;
  }
  return result;
}

function IteratorValue(iterResult) {
  return iterResult.value;
}

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

let EnqueueJob;
{
  let schedule;
  const global = (0, eval('this')); // eslint-disable-line no-eval

  // Here we try to grab a way of scheduling jobs.
  // If a real Promise exists, lets use that.
  if (typeof global.Promise !== 'undefined' &&
      Object.prototype.toString.call(new global.Promise(() => {})) === '[object Promise]') {
    const p = global.Promise.resolve();
    schedule = (f) => {
      p.then(f);
    };
  } else if (typeof setImmediate !== 'undefined') {
    // setImmediate is faster than setTimeout, but not everything has it
    schedule = setImmediate;
  } else {
    // safe fallback
    schedule = (f) => setTimeout(f, 0);
  }

  EnqueueJob = (queueName, job, args) => {
    if (queueName !== 'PromiseJobs') {
      throw new TypeError('Unknown job queue');
    }
    schedule(() => {
      job(...args);
    });
  };
}

function HostPromiseRejectionTracker(promise, operation) { // eslint-disable-line no-unused-vars
  // https://tc39.github.io/ecma262/#sec-host-promise-rejection-tracker
}

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

function NewPromiseCapability(C) {
  const promiseCapability = {
    [kPromise]: undefined,
    [kResolve]: undefined,
    [kReject]: undefined,
  };

  const promise = new C((resolve, reject) => {
    // GetCapabilitiesExecutor
    if (promiseCapability[kResolve] !== undefined ||
        promiseCapability[kReject] !== undefined) {
      throw new TypeError('Promise executor has already been invoked with non-undefined arguments');
    }
    promiseCapability[kResolve] = resolve;
    promiseCapability[kReject] = reject;
  });

  if (typeof promiseCapability[kResolve] !== 'function') {
    throw new TypeError('Promise resolve function is not callable');
  }

  if (typeof promiseCapability[kReject] !== 'function') {
    throw new TypeError('Promise reject function is not callable');
  }

  promiseCapability[kPromise] = promise;

  return promiseCapability;
}

function TriggerPromiseReactions(reactions, argument) {
  reactions.forEach((reaction) => {
    EnqueueJob('PromiseJobs', PromiseReactionJob, [reaction, argument]);
  });
  return undefined;
}

function FulfillPromise(promise, value) {
  const reactions = promise[kPromiseFulfillReactions];
  promise[kPromiseResult] = value;
  promise[kPromiseFulfillReactions] = undefined;
  promise[kPromiseRejectReactions] = undefined;
  promise[kPromiseState] = 'fulfilled';
  return TriggerPromiseReactions(reactions, value);
}

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
function IsPromise(x) {
  if (Type(x) !== 'Object') {
    return false;
  }

  if (!hasOwnProperty(x, kPromiseState)) {
    return false;
  }

  return true;
}

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

function PerformPromiseAll(iteratorRecord, constructor, resultCapability) {
  const values = [];
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
        const valuesArray = values;
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
        const valuesArray = values;
        resultCapability[kResolve].call(undefined, valuesArray);
      }

      return undefined;
    });

    remainingElementsCount += 1;

    nextPromise.then(resolveElement, resultCapability[kReject]);

    index += 1;
  }
}

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

class Promise {
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

  static resolve(x) {
    const C = this;
    if (Type(C) !== 'Object') {
      throw new TypeError();
    }
    return PromiseResolve(C, x);
  }

  static reject(r) {
    const C = this;
    if (Type(C) !== 'Object') {
      throw new TypeError();
    }
    const promiseCapability = NewPromiseCapability(C);
    promiseCapability[kReject].call(undefined, r);
    return promiseCapability[kPromise];
  }

  static get [Symbol.species]() {
    return this;
  }

  constructor(executor) {
    if (typeof executor !== 'function') {
      throw new TypeError(`${executor} is not a function`);
    }

    const promise = OrdinaryCreateFromConstructor(new.target, '%PromisePrototype%', [
      kPromiseState,
      kPromiseFulfillReactions,
      kPromiseRejectReactions,
      kPromiseIsHandled,
      kPromiseResult,
    ]);

    promise[kPromiseState] = 'pending';
    promise[kPromiseFulfillReactions] = [];
    promise[kPromiseRejectReactions] = [];
    promise[kPromiseIsHandled] = false;

    const resolvingFunctions = CreateResolvingFunctions(promise);

    try {
      executor.call(undefined, resolvingFunctions[kResolve], resolvingFunctions[kReject]);
    } catch (err) {
      resolvingFunctions[kReject].call(undefined, err);
    }

    return promise;
  }

  then(onFulfilled, onRejected) {
    const promise = this;
    if (!IsPromise(promise)) {
      throw new TypeError('method called on invalid receiver');
    }
    const C = SpeciesConstructor(promise, Promise);
    const resultCapability = NewPromiseCapability(C);
    return PerformPromiseThen(promise, onFulfilled, onRejected, resultCapability);
  }

  catch(onRejected) {
    const promise = this;
    return promise.then(undefined, onRejected);
  }

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
}

Object.defineProperty(Promise.prototype, Symbol.toStringTag, {
  value: 'Promise',
  enumerable: false,
  configurable: true,
  writable: false,
});

module.exports = Promise;
