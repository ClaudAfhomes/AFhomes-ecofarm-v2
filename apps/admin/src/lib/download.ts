export type DownloadEnvelope = { filename: string; mime: string; content: string };
export function envelopeBlob(envelope: Pick<DownloadEnvelope, 'mime' | 'content'>): Blob {
  const bytes = Uint8Array.from(atob(envelope.content), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: envelope.mime });
}
/** Keep the object URL alive until the browser has consumed the click. */
export function downloadFile(envelope: DownloadEnvelope): void {
  const url = URL.createObjectURL(envelopeBlob(envelope));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = envelope.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
