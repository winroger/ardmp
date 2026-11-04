import { DefaultTheme } from '@ulb-darmstadt/shacl-form'
import styles from './applicationShaclTheme.css?inline'

const themed = new WeakSet<HTMLElement>()

/** Install inside the form's shadow root through the supported theme API. */
export function applyApplicationShaclTheme(form: HTMLElement & { setTheme?: (theme: DefaultTheme) => void }): void {
  if (!form.setTheme || themed.has(form)) return
  form.setTheme(new DefaultTheme(styles))
  themed.add(form)
}
