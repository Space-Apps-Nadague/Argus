/**
 * ARGUS — Emergency checklists for the server RAG knowledge base (specs/05-data-platform.md §3.6)
 * Generic training aid based on public ISS practice — not a substitute for mission flight rules.
 */

// Source: SRC-004 (Exploration Medical Condition List, NTRS 20110008645)
export interface RagEmergencyProtocol {
  id: string;
  title: string;
  trigger: string;
  steps: string[];
}

export const EMERGENCY_PROTOCOLS: RagEmergencyProtocol[] = [
  {
    id: 'fire',
    title: 'Fire or smoke',
    trigger: 'Visible flame, smoke, burning smell or a smoke-detector alarm.',
    steps: [
      'Shout FIRE and alert the whole crew',
      'Power down the affected equipment and stop airflow to the area',
      'Don a mask, then attack the base of the flames with the extinguisher',
      'Isolate the module and report its location',
      'Check CO and CO₂ before removing masks',
    ],
  },
  {
    id: 'depress',
    title: 'Rapid depressurisation',
    trigger: 'Falling cabin pressure, ear popping, hissing, or a pressure alarm.',
    steps: [
      'Move toward the nearest safe hatch and listen for the leak',
      'Close hatches behind you to isolate the leaking module',
      'Don a suit or oxygen supply and check crew count',
      'Use the patch kit on a located leak',
      'Report the pressure trend every 5 minutes',
    ],
  },
  {
    id: 'toxic',
    title: 'Toxic atmosphere',
    trigger: 'Chemical smell, coolant leak (ammonia), irritated eyes or throat.',
    steps: [
      'Don a mask immediately',
      'Move to a clean module and close the hatch',
      'Identify the source and shut ventilation to the affected area',
      'Monitor and report SpO₂ for every crew member',
    ],
  },
  {
    id: 'medical',
    title: 'Crew medical emergency',
    trigger: 'Unresponsive crew member, chest pain, severe bleeding, SpO₂ below 92%.',
    steps: [
      'Check airway, breathing and circulation; call for help',
      'Start CPR if there is no pulse; secure the patient to a restraint',
      'Open the medical kit; record vitals and times',
      'Contact the Flight Surgeon (allow for the comm delay)',
      'Prepare the emergency packet with vitals and actions taken',
    ],
  },
  {
    id: 'radiation',
    title: 'Solar particle event',
    trigger: 'Space-weather alert or a sharp rise on the dosimeter.',
    steps: [
      'Move all crew to the shielded storm shelter',
      'Wear your personal dosimeter and note the start time',
      'Stay sheltered until dose rate returns to background',
      'Log cumulative dose for each crew member',
    ],
  },
  {
    id: 'co2',
    title: 'High CO₂',
    trigger: 'CO₂ above 4.5 mmHg, headaches, or slowed thinking across the crew.',
    steps: [
      'Check the CO₂ scrubber status and restart if faulted',
      'Turn on portable fans; move away from dead-air pockets',
      'Reduce exercise and crew in the affected module',
      'Re-measure CO₂ in 15 minutes and log symptoms',
    ],
  },
];

export const EMERGENCY_DISCLAIMER =
  "Generic training aid based on public ISS practice — follow your mission's flight rules.";
