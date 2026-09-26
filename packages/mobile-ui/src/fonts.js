// Jamzo fonts (DECISIONS D-107): Poppins for titles, prices and buttons; Inter for reading text. Only the
// weights the apps use are bundled (per-weight imports keep the app small).
import { useFonts } from 'expo-font';
import { Poppins_500Medium } from '@expo-google-fonts/poppins/500Medium';
import { Poppins_600SemiBold } from '@expo-google-fonts/poppins/600SemiBold';
import { Poppins_700Bold } from '@expo-google-fonts/poppins/700Bold';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';

/** @returns {boolean} true once the fonts are ready (or failed to load — the system font is used then). */
export function useJamzoFonts() {
  const [loaded, error] = useFonts({
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });
  return loaded || Boolean(error);
}
