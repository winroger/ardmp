/** Clipboard API with a user-gesture fallback for extracted file:// viewers. */
export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return }
  } catch { /* Some local-file contexts deny the asynchronous Clipboard API. */ }
  const active = document.activeElement as HTMLElement | null
  const input = document.createElement('textarea')
  input.value = text
  input.setAttribute('aria-hidden', 'true')
  input.style.cssText = 'position:fixed;left:-10000px;top:0;'
  document.body.append(input)
  input.select()
  try {
    if (!document.execCommand('copy')) throw new Error('Copy is unavailable. Select the Turtle text and copy it manually.')
  } finally { input.remove(); active?.focus() }
}
