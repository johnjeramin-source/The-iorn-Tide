import { MapId, ScenarioId } from './types';

export interface CampaignMission {
  id: number;
  name: string;
  briefing: string;
  mapId: MapId;
  scenarioId: ScenarioId;
  killTarget: number;
  sectorTarget: number;
  rescueTarget: number; // civilians that must be evacuated (0 = no rescue objective)
  reward: number;
}

// Rescue missions: Fuel Line Rescue, Airfield Extraction, Icebound Evacuation
const RESCUE_TARGETS: Record<number, number> = { 12: 40, 13: 60, 16: 80 };

const maps: MapId[] = [
  'port_la', 'downtown_flood', 'refinery', 'airfield', 'highway_overpass',
  'desert_fort', 'frozen_harbor', 'island_base', 'storm_bay', 'mountain_relay', 'fortress_zero',
];
const scenarios: ScenarioId[] = ['harbor_break', 'red_tide', 'iron_ark'];
const names = [
  'Beachhead', 'Broken Causeway', 'Refinery Sweep', 'Runway Lockdown', 'Overpass Hold',
  'Desert Shield', 'Frozen Approach', 'Island Reclaim', 'Storm Warning', 'Mountain Relay',
  'Harbor Counterattack', 'Floodgate Defense', 'Fuel Line Rescue', 'Airfield Extraction',
  'Convoy Last Stand', 'Fortress Breach', 'Icebound Evacuation', 'Island Stronghold',
  'Eye of the Storm', 'Final Tide',
];
const briefings = [
  'Secure the landing zone and establish a permanent beachhead.',
  'Clear the causeway and reopen the coastal supply route.',
  'Destroy the infected presence around the fuel refinery.',
  'Retake the runway and secure the airfield perimeter.',
  'Hold the overpass while the evacuation corridor is restored.',
  'Protect the forward fort and capture nearby sectors.',
  'Secure the frozen harbor before the next major surge.',
  'Reclaim the island base and establish coastal defenses.',
  'Survive the storm and secure the exposed shoreline.',
  'Restore the mountain relay and reopen communications.',
  'The horde is pushing back on the docks. Hold the pier line and bleed them dry.',
  'Floodwater is rising behind the gates. Defend the floodgate controls to the last sector.',
  'A fuel convoy is trapped on the line. Punch through and secure the pumping stations.',
  'Evac birds are inbound. Keep the airfield clear until the last transport lifts off.',
  'The convoy has nowhere left to run. Dig in on the highway and make a last stand.',
  'Breach the fortress walls and clear every courtyard of the infected.',
  'Civilians are stranded on the ice. Escort them to the harbor under heavy pressure.',
  'The island stronghold is the last safe ground. Fortify it before the final surge.',
  'The storm eye is a brief calm before the largest wave yet. Prepare everything.',
  'Everything comes down to this tide. Hold the coast and end the outbreak.',
];

export const CAMPAIGN_MISSIONS: CampaignMission[] = names.map((name, index) => ({
  id: index + 1,
  name,
  briefing: briefings[index % briefings.length],
  mapId: maps[index % maps.length],
  scenarioId: scenarios[index < 7 ? 0 : index < 14 ? 1 : 2],
  killTarget: 35 + index * 9 + (index % 5 === 4 ? 40 : 0),
  sectorTarget: index < 5 ? 1 : index < 13 ? 2 : 3,
  rescueTarget: RESCUE_TARGETS[index] ?? 0,
  reward: 180 + index * 35 + (index === 19 ? 500 : 0),
}));

export function getCampaignMission(id: number | null | undefined): CampaignMission | null {
  if (!id) return null;
  return CAMPAIGN_MISSIONS.find((mission) => mission.id === id) ?? null;
}
