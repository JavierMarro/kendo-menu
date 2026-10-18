/**
 * Runs the auth dispatcher before loading the ordinary application entry.
 * Callback-only paths can therefore hand their verifier to the fixed flow before route code loads.
 */
import './auth-dispatcher';
