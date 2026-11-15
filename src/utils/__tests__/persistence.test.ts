/**
 * ARGUS — Unit tests for Earth consult packets & completed countermeasure steps persistence
 * Single Source of Truth: specs/01-data-schema.md §6 & specs/02-ui-dashboard.md §2.4
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  COMPLETED_STEPS_STORAGE_KEY,
  initialState,
  loadInitialCompletedSteps,
  loadInitialPackets,
  missionReducer,
  PACKETS_STORAGE_KEY,
  sanitizeCompletedSteps,
  sanitizePackets,
  type MissionState,
} from '../../context/MissionContext';
import type { CrewMemberProfile, EarthTelemetryPacket } from '../../types/argus';

// Mock localStorage for node test environment
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

const mockStorage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', {
  value: mockStorage,
  writable: true,
  configurable: true,
});

const samplePacket: EarthTelemetryPacket = {
  packetId: 'PKT-990011',
  timestampIso: '2026-11-15T12:00:00.000Z',
  missionDay: 30,
  commDelayLabel: '10m 58s ONE-WAY',
  crewMember: {
    id: 'crew-vance',
    name: 'Cdr. Sarah Vance',
    callsign: 'Valkyrie',
    role: 'Mission Commander',
    age: 42,
    bloodType: 'O+',
  },
  environment: '0g_transit',
  scenarioId: 'unexplained_fatigue',
  readinessScore: 78,
  focusZone: 'neuro',
  zoneStatuses: {
    neuro: 'yellow',
    cardio: 'green',
    musculo: 'green',
    metabolic: 'green',
    immune: 'green',
    behavioral: 'yellow',
  },
  completedSteps: ['step-onsd-eval-1'],
  crewNotes: 'Observed slight headache and blur behind eyes.',
  urgency: 'priority_packet',
};

const sampleCustomCrew: CrewMemberProfile = {
  id: 'crew-custom-sol',
  name: 'Dr. Sol Thorne',
  callsign: 'Apex',
  role: 'Payload & Science Specialist',
  sex: 'male',
  age: 38,
  bloodType: 'A+',
  restingHrBaselineBpm: 60,
  preFlightOnsdMm: 4.8,
  missionDaysLogged: 45,
  countermeasureStreakSols: 12,
  defaultScenarioId: 'nominal',
  medicalNotes: 'Terrestrial baseline nominal.',
  isCustom: true,
};

describe('Earth consult packets & completed countermeasure steps persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('sanitizePackets', () => {
    it('returns empty object for invalid inputs', () => {
      expect(sanitizePackets(null)).toEqual({});
      expect(sanitizePackets(undefined)).toEqual({});
      expect(sanitizePackets('corrupted')).toEqual({});
      expect(sanitizePackets(42)).toEqual({});
      expect(sanitizePackets([])).toEqual({});
    });

    it('preserves valid packets and discards malformed ones', () => {
      const input = {
        'crew-vance': [
          samplePacket,
          { packetId: 'malformed-1' }, // missing timestampIso
          { timestampIso: '2026-11-15T12:00:00.000Z' }, // missing packetId
          null,
          'string-instead-of-object',
        ],
        'crew-chen': [
          {
            ...samplePacket,
            packetId: 'PKT-chen-01',
            crewMember: { ...samplePacket.crewMember, id: 'crew-chen', callsign: 'Atlas' },
          },
        ],
      };

      const result = sanitizePackets(input);
      expect(result['crew-vance']).toHaveLength(1);
      expect(result['crew-vance'][0].packetId).toBe('PKT-990011');
      expect(result['crew-chen']).toHaveLength(1);
      expect(result['crew-chen'][0].packetId).toBe('PKT-chen-01');
    });
  });

  describe('sanitizeCompletedSteps', () => {
    it('returns empty object for invalid inputs', () => {
      expect(sanitizeCompletedSteps(null)).toEqual({});
      expect(sanitizeCompletedSteps(undefined)).toEqual({});
      expect(sanitizeCompletedSteps(['array'])).toEqual({});
      expect(sanitizeCompletedSteps(123)).toEqual({});
    });

    it('filters out empty or non-string step IDs', () => {
      const input = {
        'crew-vance': ['step-1', '', null, 42, 'step-2'],
        'crew-chen': ['step-alpha'],
      };

      const result = sanitizeCompletedSteps(input);
      expect(result['crew-vance']).toEqual(['step-1', 'step-2']);
      expect(result['crew-chen']).toEqual(['step-alpha']);
    });
  });

  describe('localStorage initial loaders', () => {
    it('handles missing or malformed JSON in localStorage without throwing', () => {
      localStorage.setItem(PACKETS_STORAGE_KEY, '{invalid-json');
      localStorage.setItem(COMPLETED_STEPS_STORAGE_KEY, 'not-json');

      expect(loadInitialPackets()).toEqual({});
      expect(loadInitialCompletedSteps()).toEqual({});
    });

    it('loads and sanitizes valid records from localStorage', () => {
      const packetsData = { 'crew-vance': [samplePacket] };
      const stepsData = { 'crew-vance': ['step-1', 'step-2'] };

      localStorage.setItem(PACKETS_STORAGE_KEY, JSON.stringify(packetsData));
      localStorage.setItem(COMPLETED_STEPS_STORAGE_KEY, JSON.stringify(stepsData));

      const loadedPackets = loadInitialPackets();
      const loadedSteps = loadInitialCompletedSteps();

      expect(loadedPackets['crew-vance']).toHaveLength(1);
      expect(loadedPackets['crew-vance'][0].packetId).toBe('PKT-990011');
      expect(loadedSteps['crew-vance']).toEqual(['step-1', 'step-2']);
    });
  });

  describe('missionReducer per-crew persistence & state transitions', () => {
    it('queues an Earth packet and persists it in queuedPacketsByCrew for the active crew member', () => {
      const state = { ...initialState, activeCrewId: 'crew-vance' };
      const nextState = missionReducer(state, {
        type: 'QUEUE_EARTH_PACKET',
        payload: samplePacket,
      });

      expect(nextState.queuedPackets).toHaveLength(1);
      expect(nextState.queuedPackets[0].packetId).toBe('PKT-990011');
      expect(nextState.queuedPacketsByCrew['crew-vance']).toHaveLength(1);
      expect(nextState.queuedPacketsByCrew['crew-vance'][0].packetId).toBe('PKT-990011');
    });

    it('toggles a step and updates completedStepsByCrew for active crew member', () => {
      const state = {
        ...initialState,
        activeCrewId: 'crew-vance',
        completedStepIds: [],
        completedStepsByCrew: {},
      };

      // Toggle step-1 ON
      const state1 = missionReducer(state, {
        type: 'TOGGLE_STEP_COMPLETED',
        payload: 'step-1',
      });
      expect(state1.completedStepIds).toEqual(['step-1']);
      expect(state1.completedStepsByCrew['crew-vance']).toEqual(['step-1']);

      // Toggle step-2 ON
      const state2 = missionReducer(state1, {
        type: 'TOGGLE_STEP_COMPLETED',
        payload: 'step-2',
      });
      expect(state2.completedStepIds).toEqual(['step-1', 'step-2']);
      expect(state2.completedStepsByCrew['crew-vance']).toEqual(['step-1', 'step-2']);

      // Toggle step-1 OFF
      const state3 = missionReducer(state2, {
        type: 'TOGGLE_STEP_COMPLETED',
        payload: 'step-1',
      });
      expect(state3.completedStepIds).toEqual(['step-2']);
      expect(state3.completedStepsByCrew['crew-vance']).toEqual(['step-2']);
    });

    it('preserves packets and steps when switching crew members and loads target crew member data', () => {
      const vancePacket = { ...samplePacket, packetId: 'PKT-VANCE-01' };
      const chenPacket = { ...samplePacket, packetId: 'PKT-CHEN-01', crewMember: { ...samplePacket.crewMember, id: 'crew-chen' } };

      let state: MissionState = {
        ...initialState,
        activeCrewId: 'crew-vance',
        queuedPackets: [vancePacket],
        queuedPacketsByCrew: { 'crew-vance': [vancePacket], 'crew-chen': [chenPacket] },
        completedStepIds: ['vance-step-1', 'vance-step-2'],
        completedStepsByCrew: {
          'crew-vance': ['vance-step-1', 'vance-step-2'],
          'crew-chen': ['chen-step-x'],
        },
      };

      // Switch to crew-chen
      state = missionReducer(state, {
        type: 'SELECT_CREW_MEMBER',
        payload: 'crew-chen',
      });

      expect(state.activeCrewId).toBe('crew-chen');
      expect(state.queuedPackets).toHaveLength(1);
      expect(state.queuedPackets[0].packetId).toBe('PKT-CHEN-01');
      expect(state.completedStepIds).toEqual(['chen-step-x']);

      // Vance's data is still preserved in the by-crew maps
      expect(state.queuedPacketsByCrew['crew-vance'][0].packetId).toBe('PKT-VANCE-01');
      expect(state.completedStepsByCrew['crew-vance']).toEqual(['vance-step-1', 'vance-step-2']);

      // Switch back to crew-vance
      state = missionReducer(state, {
        type: 'SELECT_CREW_MEMBER',
        payload: 'crew-vance',
      });

      expect(state.activeCrewId).toBe('crew-vance');
      expect(state.queuedPackets[0].packetId).toBe('PKT-VANCE-01');
      expect(state.completedStepIds).toEqual(['vance-step-1', 'vance-step-2']);
    });

    it('clears persisted packets and steps when a custom crew member is deleted', () => {
      let state: MissionState = {
        ...initialState,
        crewRoster: [...initialState.crewRoster, sampleCustomCrew],
        activeCrewId: sampleCustomCrew.id,
        queuedPackets: [samplePacket],
        queuedPacketsByCrew: {
          [sampleCustomCrew.id]: [samplePacket],
          'crew-vance': [samplePacket],
        },
        completedStepIds: ['custom-step-1'],
        completedStepsByCrew: {
          [sampleCustomCrew.id]: ['custom-step-1'],
          'crew-vance': ['vance-step-1'],
        },
      };

      state = missionReducer(state, {
        type: 'DELETE_CREW_MEMBER',
        payload: sampleCustomCrew.id,
      });

      // Custom crew member deleted from roster and by-crew storage
      expect(state.crewRoster.some((c) => c.id === sampleCustomCrew.id)).toBe(false);
      expect(state.queuedPacketsByCrew[sampleCustomCrew.id]).toBeUndefined();
      expect(state.completedStepsByCrew[sampleCustomCrew.id]).toBeUndefined();

      // Active crew switched to next available astronaut (crew-vance)
      expect(state.activeCrewId).toBe('crew-vance');
      expect(state.queuedPacketsByCrew['crew-vance']).toHaveLength(1);
      expect(state.completedStepsByCrew['crew-vance']).toEqual(['vance-step-1']);
    });

    it('supports clearing queued packets and completed steps on demand', () => {
      let state: MissionState = {
        ...initialState,
        activeCrewId: 'crew-vance',
        queuedPackets: [samplePacket],
        queuedPacketsByCrew: { 'crew-vance': [samplePacket] },
        completedStepIds: ['step-1'],
        completedStepsByCrew: { 'crew-vance': ['step-1'] },
      };

      state = missionReducer(state, { type: 'CLEAR_QUEUED_PACKETS', payload: 'crew-vance' });
      expect(state.queuedPackets).toEqual([]);
      expect(state.queuedPacketsByCrew['crew-vance']).toBeUndefined();

      state = missionReducer(state, { type: 'CLEAR_COMPLETED_STEPS', payload: 'crew-vance' });
      expect(state.completedStepIds).toEqual([]);
      expect(state.completedStepsByCrew['crew-vance']).toBeUndefined();
    });
  });

  describe('reload / remount survival simulation', () => {
    it('restores queued packets and completed steps across simulated page reload', () => {
      // 1. Simulate astronaut Vance queueing a packet and completing steps before reload
      const storedPackets = {
        'crew-vance': [samplePacket],
      };
      const storedSteps = {
        'crew-vance': ['step-neuro-1', 'step-neuro-2'],
      };

      localStorage.setItem(PACKETS_STORAGE_KEY, JSON.stringify(storedPackets));
      localStorage.setItem(COMPLETED_STEPS_STORAGE_KEY, JSON.stringify(storedSteps));

      // 2. Simulate page reload: load from localStorage
      const reloadedPackets = loadInitialPackets();
      const reloadedSteps = loadInitialCompletedSteps();

      expect(reloadedPackets['crew-vance']).toHaveLength(1);
      expect(reloadedPackets['crew-vance'][0].packetId).toBe('PKT-990011');
      expect(reloadedPackets['crew-vance'][0].urgency).toBe('priority_packet');
      expect(reloadedSteps['crew-vance']).toEqual(['step-neuro-1', 'step-neuro-2']);

      // 3. Construct reloaded initial state
      const reloadedState = {
        ...initialState,
        activeCrewId: 'crew-vance',
        completedStepIds: reloadedSteps['crew-vance'] || [],
        completedStepsByCrew: reloadedSteps,
        queuedPackets: reloadedPackets['crew-vance'] || [],
        queuedPacketsByCrew: reloadedPackets,
      };

      expect(reloadedState.completedStepIds).toEqual(['step-neuro-1', 'step-neuro-2']);
      expect(reloadedState.queuedPackets).toHaveLength(1);
      expect(reloadedState.queuedPackets[0].packetId).toBe('PKT-990011');

      // 4. Queue another packet after reload
      const newEmergencyPacket: EarthTelemetryPacket = {
        ...samplePacket,
        packetId: 'PKT-990022',
        urgency: 'immediate_emergency_packet',
        timestampIso: '2026-11-15T12:30:00.000Z',
      };

      const updatedState = missionReducer(reloadedState, {
        type: 'QUEUE_EARTH_PACKET',
        payload: newEmergencyPacket,
      });

      expect(updatedState.queuedPackets).toHaveLength(2);
      expect(updatedState.queuedPackets[0].packetId).toBe('PKT-990022');
      expect(updatedState.queuedPackets[1].packetId).toBe('PKT-990011');
      expect(updatedState.queuedPacketsByCrew['crew-vance']).toHaveLength(2);
    });
  });
});
