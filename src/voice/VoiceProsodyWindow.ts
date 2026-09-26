export const VOICE_PROSODY_PAGE_SIZE = 72;

export interface VoiceProsodyWindow {
  page: number;
  pageCount: number;
  start: number;
  end: number;
  visibleCount: number;
}

export function getVoiceProsodyWindow(
  totalCount: number,
  requestedPage: number,
  pageSize = VOICE_PROSODY_PAGE_SIZE,
): VoiceProsodyWindow {
  const safeTotal = Math.max(0, Math.floor(totalCount));
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const page = Math.max(0, Math.min(pageCount - 1, Math.floor(requestedPage) || 0));
  const start = Math.min(safeTotal, page * safePageSize);
  const end = Math.min(safeTotal, start + safePageSize);

  return {
    page,
    pageCount,
    start,
    end,
    visibleCount: Math.max(0, end - start),
  };
}
