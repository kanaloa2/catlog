import { supabase } from '../supabase';

/**
 * Saves an import troubleshooting report to the account (catlog_import_reports), so it can be
 * read for support without copying and pasting. Structure and errors only, never row data.
 * Failures are ignored: a report must never get in the way of the import itself.
 */
export async function saveReport(step: string, error: string, details: Record<string, unknown> = {}): Promise<boolean> {
  try {
    const { error: e } = await supabase.from('catlog_import_reports').insert({
      step: step.slice(0, 200),
      error: error.slice(0, 4000),
      details: { ...details, app: 'catlog', page: location.href.split('#')[0], userAgent: navigator.userAgent },
    });
    return !e;
  } catch {
    return false;
  }
}
