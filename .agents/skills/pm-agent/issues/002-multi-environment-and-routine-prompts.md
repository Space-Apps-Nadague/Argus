**Priority:** `P1` • **Refs:** `REQ-07`, `REQ-08`, `REQ-09`

### Why it matters
The challenge specifically asks for **multi-environment insights** (spacecraft, station, rover, planetary base), **periodic routine prompts**, and **gamification**.

### PM Critique
- Commit `26c2db4` removed multi-environment switching, leaving only a static `0g_transit` mode.
- Countermeasures sit passively in `FlightSurgeonPanel.tsx` instead of actively prompting the astronaut for scheduled daily checks.

### Tasks
- [ ] Add a **Habitat / Environment Selector** in `TopMissionBar.tsx` (`Spacecraft`, `Space Station`, `Surface Rover`, `Lunar/Mars Base`).
- [ ] Add a **"Scheduled Mission Routine"** prompt banner for due daily measurements (`REQ-08`).
- [ ] Award visible readiness milestone badges when daily routines are completed (`REQ-09`).
