// Freeze the BROWSER clock to the fixed test instant BEFORE the app loads, so the
// whole suite is deterministic on any calendar day (including a real Saturday) —
// the app's "today" (dateKey + weekday, resolved in Asia/Jerusalem) is always the
// frozen day. We override only Date (not setTimeout/setInterval), so Firebase's
// own timers keep working. addInitScript re-runs on every navigation/reload, so
// the clock stays frozen across reloads.
import { FROZEN_INSTANT_ISO } from '../fixtures/seed-data.js';

export async function freezeClock(page) {
  await page.addInitScript((iso) => {
    const fixedMs = new Date(iso).getTime();
    const RealDate = Date;

    class FrozenDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) {
          super(fixedMs); // new Date() -> the frozen instant
        } else {
          super(...args); // explicit construction is unchanged
        }
      }

      static now() {
        return fixedMs;
      }
    }

    globalThis.Date = FrozenDate;
  }, FROZEN_INSTANT_ISO);
}
