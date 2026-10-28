export const tiers = [
    { name: 'hot', label: 'Hot', min: 80, color: '#36a64f', emoji: '🔥' },
    { name: 'warm', label: 'Warm', min: 60, color: '#ffb84d', emoji: '🌤️' },
    { name: 'cool', label: 'Cool', min: 40, color: '#ff9500', emoji: '🌥️' },
    { name: 'cold', label: 'Cold', min: 0, color: '#ff4444', emoji: '🧊' }
];

export const tierFor = score => tiers.find(tier => score >= tier.min) ?? tiers.at(-1);
