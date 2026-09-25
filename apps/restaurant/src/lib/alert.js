// New-order alert (spec §19/§20: "loud, repeating, difficult to miss"): a looping chime and vibration while
// at least one order is waiting for acceptance and the app is open. Plays even with the iPhone's silent
// switch on. When the app is in the background, the push notification's sound takes over (D-69).
// The chime is a PLACEHOLDER (scripts/generate-order-sound.mjs, Q-13).
import { useEffect } from 'react';
import { Vibration } from 'react-native';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';

const CHIME = require('../../assets/sounds/new_order.wav');

export function useNewOrderAlert(active) {
  const player = useAudioPlayer(CHIME);
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!active) return undefined;
    player.loop = true;
    player.seekTo(0);
    player.play();
    Vibration.vibrate([0, 700, 700], true);
    return () => {
      player.pause();
      Vibration.cancel();
    };
  }, [active, player]);
}
