/**
 * Violation tracking and alerting
 * @module @tamma/gates/violations
 */

export {
  ViolationRecorder,
  createViolationRecorder,
  type ViolationRecorderOptions,
} from './violation-recorder.js';

export {
  ViolationAlerter,
  createViolationAlerter,
  type ViolationAlerterOptions,
  type ViolationAlert,
  type AlertLevel,
  type AlertThreshold,
  type AlertHandler,
} from './violation-alerter.js';
