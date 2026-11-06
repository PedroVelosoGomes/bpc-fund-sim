import { useEffect, useState } from 'react';
import { useStore } from '../state/store';

export function useResolvedTheme(): 'light' | 'dark' {
  const pref = useStore((s) => s.ui.theme);
  const [sys, setSys] = useState<'light' | 'dark'>(() => (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const fn = () => setSys(mq.matches ? 'dark' : 'light');
    mq?.addEventListener('change', fn);
    return () => mq?.removeEventListener('change', fn);
  }, []);
  return pref === 'system' ? sys : pref;
}

/** Chart colours (validated reference palette: first three categorical slots, both modes). */
export function chartColors(theme: 'light' | 'dark') {
  return theme === 'dark'
    ? { series: ['#3987e5', '#d95926', '#199e70'], grid: '#2c2c2a', axis: '#8a8984', text: '#c3c2b7', surface: '#1a1a19', bad: '#d03b3b', ref: '#c3c2b7' }
    : { series: ['#2a78d6', '#eb6834', '#1baf7a'], grid: '#ebeae6', axis: '#8a8984', text: '#52514e', surface: '#fcfcfb', bad: '#d03b3b', ref: '#52514e' };
}

/** Sequential blue ramp (100→650) for heatmaps. */
export const SEQ_BLUE = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281'];
