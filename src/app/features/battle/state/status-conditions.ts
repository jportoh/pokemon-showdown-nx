/** The major status conditions, as the status boxes and the field's labels show them. */
export const STATUS: Record<string, { text: string; name: string; color: string }> = {
  brn: { text: 'BRN', name: 'burned', color: '#c2410c' },
  par: { text: 'PAR', name: 'paralyzed', color: '#a16207' },
  psn: { text: 'PSN', name: 'poisoned', color: '#7e22ce' },
  tox: { text: 'TOX', name: 'badly poisoned', color: '#7e22ce' },
  slp: { text: 'SLP', name: 'asleep', color: '#4b5563' },
  frz: { text: 'FRZ', name: 'frozen', color: '#0369a1' },
};
