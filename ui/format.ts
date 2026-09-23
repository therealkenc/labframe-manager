import { UI } from './constants.js';

export const formatTime = (milliseconds: number, timeZone: string): string =>
  new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(milliseconds);

export const formatTimestamp = (timestampNs: string, timeZone: string): string =>
  formatTime(Number(BigInt(timestampNs) / UI.nanosecondsPerMillisecond), timeZone);

export const formatFullTimestamp = (timestampNs: string, timeZone: string): string =>
  new Intl.DateTimeFormat(undefined, {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'long',
  }).format(Number(BigInt(timestampNs) / UI.nanosecondsPerMillisecond));

export const formatJson = (value: object): string =>
  JSON.stringify(value, undefined, UI.jsonIndent);
