import { writable } from "svelte/store";

const COUNTDOWN_FROM = 1000;

// const formatter = new Intl.DateTimeFormat("es", {
//   hourCycle: 'h23',
//   hour: "2-digit",
//   minute: "2-digit",
//   second: "2-digit"
// });

const formatter = new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: 'GMT'
  });

export const time = writable(formatter.format(COUNTDOWN_FROM));
export const isRunning = writable(false);
export const isComplete = writable(false);
export const remainingTime = COUNTDOWN_FROM;

const createTimer = () => {
  let animationRef;
  let latestStartTime;
  let remainingTime = COUNTDOWN_FROM;

  const animate = (timestamp) => {
    // is it the first iteration in this cycle?
    if (latestStartTime === undefined) {
      // make a note of the start time
      latestStartTime = timestamp + remainingTime;
    }

    // the time to display now
    const currentTime = latestStartTime - timestamp;
    // console.log(timestamp, latestStartTime);

    if (currentTime <= 0) {
      cancelAnimationFrame(animationRef);
      time.set(formatter.format(0));
      isRunning.set(false);
      isComplete.set(true);
      return;
    }
    time.set(formatter.format(currentTime));

    // keep animating recursively
    animationRef = requestAnimationFrame(animate);
  };

  const api = {
    start: (times) => {
      latestStartTime = times;
      isRunning.set(true);
      animationRef = requestAnimationFrame(animate);
    },

    pause: () => {
      cancelAnimationFrame(animationRef);
      if (latestStartTime !== undefined) {
        // prepare for the next cycle
        remainingTime = latestStartTime - performance.now();
        latestStartTime = undefined;
      }
      isRunning.set(false);
    },

    reset: Function.prototype
  };

  return api;
};

export const timer = createTimer();
