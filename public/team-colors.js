export const teamColors = {
  red: 'Rosso',
  orange: 'Arancione',
  yellow: 'Giallo',
  green: 'Verde',
  blue: 'Blu',
  cyan: 'Azzurro',
  purple: 'Viola',
  pink: 'Rosa',
  brown: 'Marrone',
  white: 'Bianco',
  black: 'Nero',
  gray: 'Grigio'
};

export const teamColorLabel = color => Object.hasOwn(teamColors, color) ? teamColors[color] : 'Da scegliere';
