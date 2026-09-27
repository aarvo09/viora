/* Time-of-day greeting. PURE, node-testable.
 *
 * English and Hindi, because all three test users are Hindi speakers and the
 * English is what a caseworker standing beside them reads — the same split as
 * the voice screen's labels.
 */

export interface Greeting {
  en: string
  hi: string
}

export function greetingFor(hour: number): Greeting {
  if (hour >= 5 && hour < 12) {
    return { en: 'Good morning', hi: 'सुप्रभात' }
  }
  if (hour >= 12 && hour < 17) {
    return { en: 'Good afternoon', hi: 'नमस्ते' }
  }
  if (hour >= 17 && hour < 22) {
    return { en: 'Good evening', hi: 'शुभ संध्या' }
  }
  // 22:00–05:00. A check-in in these hours is someone who could not sleep,
  // never a reason to be chipper.
  return { en: 'Good night', hi: 'शुभ रात्रि' }
}
