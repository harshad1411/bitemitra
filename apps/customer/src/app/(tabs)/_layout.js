// Bottom tabs (D-108): Home, Search, Orders, Account. Every other screen opens on top with a back arrow.
import { Tabs } from 'expo-router';
import { Icon, useTheme } from '@jamzo/mobile-ui';

const TABS = [
  ['index', 'Home', 'home'],
  ['search', 'Search', 'search'],
  ['orders', 'Orders', 'receipt'],
  ['account', 'Account', 'person'],
];

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.colors.primary,
        tabBarInactiveTintColor: t.colors.textSubtle,
        tabBarLabelStyle: { fontFamily: t.fonts.medium, fontSize: 11 },
        tabBarStyle: { borderTopColor: t.colors.border, backgroundColor: t.colors.surface },
      }}
    >
      {TABS.map(([name, title, icon]) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarAccessibilityLabel: title,
            tabBarIcon: ({ color, focused }) => (
              <Icon name={focused ? icon : `${icon}-outline`} size={22} color={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
