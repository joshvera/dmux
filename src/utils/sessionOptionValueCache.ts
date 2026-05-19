export interface SessionOptionValueCacheEntry {
  sessionName: string;
  value: string;
}

export function shouldSetSessionOptionValue(
  cached: SessionOptionValueCacheEntry | null | undefined,
  sessionName: string,
  value: string
): boolean {
  return cached?.sessionName !== sessionName || cached.value !== value;
}

export function createSessionOptionValueCacheEntry(
  sessionName: string,
  value: string
): SessionOptionValueCacheEntry {
  return { sessionName, value };
}

export function setSessionOptionValueIfChanged(options: {
  cached: SessionOptionValueCacheEntry | null | undefined;
  sessionName: string;
  value: string;
  setValue: () => boolean;
}): SessionOptionValueCacheEntry | null {
  const current = options.cached ?? null;
  if (!shouldSetSessionOptionValue(current, options.sessionName, options.value)) {
    return current;
  }

  return options.setValue()
    ? createSessionOptionValueCacheEntry(options.sessionName, options.value)
    : current;
}
