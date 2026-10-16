// Server-only bounded response reader. No outbound requests, storage or writes.
// Never buffer an entire vendor response before enforcing its byte limit.
function problem(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
function cancelQuietly(body) {
  // Cancellation itself may stall or reject. Never await untrusted cleanup.
  try { Promise.resolve(body?.cancel()).catch(() => {}); } catch {}
}
function readChunk(reader, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(problem('PROVIDER_UNAVAILABLE'));
    signal.addEventListener('abort', aborted, { once: true });
    const clear = () => signal.removeEventListener('abort', aborted);
    if (signal.aborted) {
      clear();
      aborted();
      return;
    }
    let pending;
    try { pending = reader.read(); }
    catch {
      clear();
      reject(problem('PROVIDER_UNAVAILABLE'));
      return;
    }
    Promise.resolve(pending).then(
      value => { clear(); resolve(value); },
      () => { clear(); reject(problem('PROVIDER_UNAVAILABLE')); }
    );
  });
}
async function readBoundedResponseText(response, { maxBytes, signal } = {}) {
  let reader;
  let complete = false;
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 65536 ||
        !signal || typeof signal.addEventListener !== 'function' ||
        typeof signal.removeEventListener !== 'function') {
      throw problem('MODEL_INVALID_RESPONSE');
    }
    if (signal.aborted) throw problem('PROVIDER_UNAVAILABLE');
    const declared = response?.headers?.get('content-length');
    if (declared != null && (!/^\d+$/.test(declared) ||
        !Number.isSafeInteger(Number(declared)) || Number(declared) > maxBytes)) {
      throw problem('MODEL_INVALID_RESPONSE');
    }
    if (typeof response?.body?.getReader !== 'function') {
      // No response.text()/json() fallback: that would reintroduce unbounded reads.
      throw problem('MODEL_INVALID_RESPONSE');
    }
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const parts = [];
    let bytes = 0;
    for (;;) {
      const chunk = await readChunk(reader, signal);
      if (signal.aborted) throw problem('PROVIDER_UNAVAILABLE');
      if (chunk.done) {
        parts.push(decoder.decode());
        complete = true;
        return parts.join('');
      }
      if (!(chunk.value instanceof Uint8Array)) {
        throw problem('MODEL_INVALID_RESPONSE');
      }
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw problem('MODEL_INVALID_RESPONSE');
      parts.push(decoder.decode(chunk.value, { stream: true }));
    }
  } catch (error) {
    // Never expose vendor body, exception message, credentials or internal errors.
    throw problem(error?.code === 'PROVIDER_UNAVAILABLE'
      ? 'PROVIDER_UNAVAILABLE' : 'MODEL_INVALID_RESPONSE');
  } finally {
    if (!complete) cancelQuietly(reader || response?.body);
    try { reader?.releaseLock(); } catch {}
  }
}
export { readBoundedResponseText, cancelQuietly };
