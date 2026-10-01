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
    .slice(0, 12);
  return names.length === 0 ? 'unavailable' : names.join(' > ');
}

export function buildErrorReport(input: ErrorReportInput): string {
  return [
    `LabML ${input.version}`,
    `Time: ${input.timestamp}`,
    `Scope: ${input.scope}`,
    `Route: ${input.pathname}`,
    `Language: ${input.language}`,
    `Error type: ${input.error.name || 'Error'}`,
    `Browser: ${input.userAgent}`,
    `Components: ${componentNames(input.componentStack)}`,
    '',
    'No dataset content, file name, URL parameters, or error message is included.',
  ].join('\n');
}
