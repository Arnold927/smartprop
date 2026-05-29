/**
 * errors.ts
 *
 * Single source of truth for every user-facing error message in SmartProp
 * mobile. All API failures, offline actions, validation errors, and sync
 * states go through here so messaging is consistent and human-friendly.
 *
 * Design principles:
 *  - Never show a raw HTTP status code or stack trace to the user
 *  - Distinguish between "your fault" (validation), "server fault" (5xx),
 *    "network fault" (timeout/offline), and "auth fault" (401/403)
 *  - Always tell the user what happened AND what they can do next
 *  - Offline actions get encouraging messages — nothing is lost
 */

// ── Error categories ──────────────────────────────────────────────────────────

export type AppErrorCode =
  // Network
  | 'OFFLINE'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  // Auth
  | 'SESSION_EXPIRED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  // Server
  | 'SERVER_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  // Validation
  | 'VALIDATION_ERROR'
  // Sync
  | 'SYNC_FAILED'
  | 'QUEUE_FULL'
  // Feature-specific
  | 'UPLOAD_FAILED'
  | 'QR_INVALID'
  | 'GPS_UNAVAILABLE'
  | 'CAMERA_DENIED'
  | 'UNKNOWN';

export interface AppError {
  code:     AppErrorCode;
  title:    string;
  message:  string;
  action?:  string;   // CTA label shown to user
  canRetry: boolean;
  isOfflineQueued?: boolean;
}

// ── Classification ────────────────────────────────────────────────────────────

/**
 * Classify a raw API error string or HTTP status into a structured AppError.
 * Pass `context` to get a feature-specific message (e.g. 'maintenance request').
 */
export function classifyError(
  rawError: string | undefined,
  httpStatus?: number,
  context?: string,
): AppError {
  const err = rawError?.toLowerCase() ?? '';
  const ctx = context ?? 'this action';

  // Network / connectivity
  if (err.includes('network') || err.includes('fetch') || err.includes('connection refused')) {
    return {
      code:     'NETWORK_ERROR',
      title:    'Connection problem',
      message:  `SmartProp couldn't reach the server. Check your data or Wi-Fi connection, then try again.`,
      action:   'Retry',
      canRetry: true,
    };
  }
  if (err.includes('timed out') || err.includes('abort') || err.includes('timeout')) {
    return {
      code:     'TIMEOUT',
      title:    'Request timed out',
      message:  `The server took too long to respond. This can happen on a slow connection — ${ctx} was not saved.`,
      action:   'Try Again',
      canRetry: true,
    };
  }

  // Auth
  if (httpStatus === 401 || err.includes('session expired') || err.includes('unauthorized')) {
    return {
      code:     'SESSION_EXPIRED',
      title:    'Session expired',
      message:  'Your session has ended. Please sign in again to continue.',
      action:   'Sign In',
      canRetry: false,
    };
  }
  if (httpStatus === 403 || err.includes('forbidden') || err.includes('permission')) {
    return {
      code:     'FORBIDDEN',
      title:    'Access denied',
      message:  `You don't have permission to ${ctx}. Contact your administrator if this is unexpected.`,
      canRetry: false,
    };
  }

  // Server errors
  if (httpStatus && httpStatus >= 500) {
    return {
      code:     'SERVER_ERROR',
      title:    'Server error',
      message:  `SmartProp's server encountered a problem and couldn't complete ${ctx}. Your data is safe — please try again in a moment.`,
      action:   'Retry',
      canRetry: true,
    };
  }
  if (httpStatus === 404 || err.includes('not found')) {
    return {
      code:     'NOT_FOUND',
      title:    'Not found',
      message:  `The requested record no longer exists or has been removed.`,
      canRetry: false,
    };
  }
  if (httpStatus === 409 || err.includes('conflict') || err.includes('duplicate') || err.includes('already exists')) {
    return {
      code:     'CONFLICT',
      title:    'Duplicate entry',
      message:  `A record with the same details already exists. Please check and try again.`,
      canRetry: false,
    };
  }
  if (httpStatus === 422 || err.includes('validation') || err.includes('invalid')) {
    return {
      code:     'VALIDATION_ERROR',
      title:    'Invalid information',
      message:  `Some of the information provided is incorrect. Please review the form and try again.`,
      canRetry: false,
    };
  }

  // Feature-specific
  if (err.includes('upload')) {
    return {
      code:     'UPLOAD_FAILED',
      title:    'Upload failed',
      message:  `The photo couldn't be uploaded. Check your connection and try again, or skip the photo for now.`,
      action:   'Retry',
      canRetry: true,
    };
  }

  return {
    code:     'UNKNOWN',
    title:    'Something went wrong',
    message:  `SmartProp couldn't complete ${ctx}. Please try again. If the problem persists, contact support.`,
    action:   'Retry',
    canRetry: true,
  };
}

// ── Offline action messages ───────────────────────────────────────────────────

export type OfflineActionType =
  | 'maintenance_request'
  | 'inspection'
  | 'visitor_checkin'
  | 'patrol_log'
  | 'incident_report'
  | 'payment_reminder';

interface OfflineMessage {
  title:   string;
  message: string;
  icon:    string;
}

export const OFFLINE_MESSAGES: Record<OfflineActionType, OfflineMessage> = {
  maintenance_request: {
    title:   'Saved for when you're back online',
    message: 'Your maintenance request has been saved to this device. It will automatically upload when you reconnect to the internet — nothing is lost.',
    icon:    'cloud-upload',
  },
  inspection: {
    title:   'Inspection saved locally',
    message: 'The inspection record is stored on your device and will sync to SmartProp the moment your connection is restored.',
    icon:    'fact-check',
  },
  visitor_checkin: {
    title:   'Visitor logged offline',
    message: 'This visitor check-in has been recorded on your device. It will appear in the system once you're back online.',
    icon:    'person-add',
  },
  patrol_log: {
    title:   'Patrol saved to device',
    message: 'Your patrol log — including all checkpoints and GPS data — is saved locally and will sync automatically.',
    icon:    'directions-walk',
  },
  incident_report: {
    title:   'Incident recorded locally',
    message: 'The incident report is saved on your device. Management will be notified as soon as your connection is restored.',
    icon:    'report-problem',
  },
  payment_reminder: {
    title:   'Reminder queued',
    message: 'The payment reminder will be sent once you reconnect to the internet.',
    icon:    'notifications',
  },
};

// ── Success messages ──────────────────────────────────────────────────────────

export const SUCCESS_MESSAGES: Record<string, { title: string; message: string }> = {
  maintenance_request: {
    title:   'Request submitted',
    message: 'Your maintenance request has been logged. The relevant team will be notified.',
  },
  inspection: {
    title:   'Inspection saved',
    message: 'The inspection record has been added to the property history.',
  },
  visitor_checkin: {
    title:   'Visitor checked in',
    message: 'The visitor has been registered and logged in today's security log.',
  },
  patrol_log: {
    title:   'Patrol logged',
    message: 'Your patrol has been recorded with all checkpoints.',
  },
  incident_report: {
    title:   'Incident reported',
    message: 'Your report has been submitted and management has been notified.',
  },
  sync_complete: {
    title:   'Up to date',
    message: 'All data has been synchronised with SmartProp.',
  },
  sync_partial: {
    title:   'Mostly synced',
    message: 'Data refreshed. Some items are still queued and will upload shortly.',
  },
  queue_flushed: {
    title:   'Offline actions uploaded',
    message: 'All saved offline actions have been successfully sent to the server.',
  },
};

// ── Validation helpers ────────────────────────────────────────────────────────

export interface ValidationResult {
  valid:  boolean;
  errors: Record<string, string>;
}

export function validateMaintenanceForm(form: {
  title: string;
  description: string;
  unitId?: string;
}): ValidationResult {
  const errors: Record<string, string> = {};
  if (!form.title.trim())
    errors.title = 'A title is required so the team knows what to fix.';
  else if (form.title.trim().length < 5)
    errors.title = 'Please describe the issue in at least 5 characters.';
  if (!form.description.trim())
    errors.description = 'A description is required — include as much detail as you can.';
  else if (form.description.trim().length < 10)
    errors.description = 'The description is too short. Please add more detail.';
  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateVisitorForm(form: {
  name: string;
  purpose: string;
}): ValidationResult {
  const errors: Record<string, string> = {};
  if (!form.name.trim())
    errors.name = 'Visitor name is required for the security log.';
  if (!form.purpose.trim())
    errors.purpose = 'Purpose of visit is required.';
  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateLoginForm(email: string, password: string): ValidationResult {
  const errors: Record<string, string> = {};
  if (!email.trim()) errors.email = 'Please enter your email address.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    errors.email = 'That doesn't look like a valid email address.';
  if (!password) errors.password = 'Please enter your password.';
  else if (password.length < 6) errors.password = 'Password must be at least 6 characters.';
  return { valid: Object.keys(errors).length === 0, errors };
}
