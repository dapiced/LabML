export interface ErrorReportInput {
  error: Error;
  componentStack: string;
  scope: 'app' | 'section';
  pathname: string;
  language: string;
  userAgent: string;
  timestamp: string;
  version: string;
}

function componentNames(stack: string): string {
  const names = stack
    .split('\n')
    .map((line) => /^\s*at\s+([A-Za-z0-9_$.]+)/.exec(line)?.[1])
    .filter((name): name is string => Boolean(name))
    .map((name) => name.slice(0, 80))
    .slice(0, 12);
  return names.length === 0 ? 'unavailable' : names.join(' > ');
}

function cleanField(value: string, maxLength: number): string {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || (code >= 127 && code <= 159) ? ' ' : character;
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function errorType(error: Error): string {
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name) ? error.name : 'Error';
}

export function buildErrorReport(input: ErrorReportInput): string {
  return [
    `LabML ${cleanField(input.version, 32)}`,
    `Time: ${cleanField(input.timestamp, 32)}`,
    `Scope: ${input.scope}`,
    `Route: ${cleanField(input.pathname, 256)}`,
    `Language: ${/^[A-Za-z0-9-]{1,32}$/.test(input.language) ? input.language : 'unknown'}`,
    `Error type: ${errorType(input.error)}`,
    `Browser: ${cleanField(input.userAgent, 256)}`,
    `Components: ${componentNames(input.componentStack)}`,
    '',
    'No dataset content, file name, URL parameters, or error message is included.',
  ].join('\n');
}
