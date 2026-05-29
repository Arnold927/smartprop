/**
 * App.tsx  (updated — wires ToastProvider + SyncStatusProvider)
 *
 * Changes vs previous version:
 *  - ToastProvider wraps the whole app so any screen can call useToast()
 *  - SyncStatusProvider wraps MainTabs so the persistent sync bar
 *    is available on every main screen
 *  - All other structure unchanged
 */

import React, { useRef } from 'react';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';

// Screens
import DashboardScreen      from './screens/DashboardScreen';
import PropertiesScreen     from './screens/PropertiesScreen';
import PropertyDetailScreen from './screens/PropertyDetailScreen';
import TenantsScreen        from './screens/TenantsScreen';
import TenantDetailScreen   from './screens/TenantDetailScreen';
import MaintenanceScreen    from './screens/MaintenanceScreen';
import MaintenanceDetailScreen from './screens/MaintenanceDetailScreen';
import InspectionsScreen    from './screens/InspectionsScreen';
import SecurityScreen       from './screens/SecurityScreen';
import PatrolLogScreen      from './screens/PatrolLogScreen';
import IncidentReportScreen from './screens/IncidentReportScreen';
import SettingsScreen       from './screens/SettingsScreen';
import LoginScreen          from './screens/auth/LoginScreen';
import AuthLoadingScreen    from './screens/auth/AuthLoadingScreen';

// Services & providers
import { AuthProvider, useAuth }                          from './services/auth';
import { SyncProvider }                                   from './services/sync';
import { notificationService, setNotificationNavigationRef } from './services/notifications';
import { ToastProvider }                                  from './components/Toast';
import { SyncStatusProvider }                             from './components/SyncStatusBar';

const Icon = MaterialIcons as any;
const Tab   = createBottomTabNavigator();
const Stack = createStackNavigator();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: any) => {
        // Don't retry auth errors
        if (error?.errorCode === 'SESSION_EXPIRED') return false;
        if (error?.errorCode === 'FORBIDDEN')       return false;
        return failureCount < 2;
      },
      staleTime:           30_000,
      refetchOnWindowFocus: false,
    },
  },
});

notificationService.initialize();

// ── Auth stack ────────────────────────────────────────────────────────────────

const AuthStack = () => (
  <Stack.Navigator id="AuthStack" screenOptions={{ headerShown: false }}>
    <Stack.Screen name="AuthLoading" component={AuthLoadingScreen} />
    <Stack.Screen name="Login"       component={LoginScreen} />
  </Stack.Navigator>
);

// ── Feature stacks ────────────────────────────────────────────────────────────

const PropertiesStack = () => (
  <Stack.Navigator id="PropertiesStack" screenOptions={{ headerStyle: { backgroundColor: '#3B82F6' }, headerTintColor: '#fff', headerTitleStyle: { fontWeight: 'bold' } }}>
    <Stack.Screen name="PropertiesList"  component={PropertiesScreen}     options={{ title: 'Properties' }} />
    <Stack.Screen name="PropertyDetail"  component={PropertyDetailScreen}  options={{ title: 'Property' }} />
  </Stack.Navigator>
);

const TenantsStack = () => (
  <Stack.Navigator id="TenantsStack" screenOptions={{ headerStyle: { backgroundColor: '#10B981' }, headerTintColor: '#fff', headerTitleStyle: { fontWeight: 'bold' } }}>
    <Stack.Screen name="TenantsList"  component={TenantsScreen}      options={{ title: 'Tenants' }} />
    <Stack.Screen name="TenantDetail" component={TenantDetailScreen}  options={{ title: 'Tenant' }} />
  </Stack.Navigator>
);

const MaintenanceStack = () => (
  <Stack.Navigator id="MaintenanceStack" screenOptions={{ headerStyle: { backgroundColor: '#F59E0B' }, headerTintColor: '#fff', headerTitleStyle: { fontWeight: 'bold' } }}>
    <Stack.Screen name="MaintenanceList"   component={MaintenanceScreen}       options={{ title: 'Maintenance' }} />
    <Stack.Screen name="MaintenanceDetail" component={MaintenanceDetailScreen} options={{ title: 'Request' }} />
  </Stack.Navigator>
);

const SecurityStack = () => (
  <Stack.Navigator id="SecurityStack" screenOptions={{ headerShown: false }}>
    <Stack.Screen name="SecurityMain"   component={SecurityScreen} />
    <Stack.Screen name="PatrolLog"      component={PatrolLogScreen} />
    <Stack.Screen name="IncidentReport" component={IncidentReportScreen} />
  </Stack.Navigator>
);

// ── Main tabs ─────────────────────────────────────────────────────────────────

const TAB_ICONS: Record<string, string> = {
  Dashboard:      'dashboard',
  PropertiesTab:  'home',
  TenantsTab:     'people',
  MaintenanceTab: 'build',
  Inspections:    'fact-check',
  Security:       'security',
  Settings:       'settings',
};

const MainTabs = () => (
  <SyncStatusProvider>
    <Tab.Navigator
      id="MainTabNavigator"
      screenOptions={({ route }) => ({
        tabBarIcon: ({ color, size }) => (
          <Icon name={TAB_ICONS[route.name] ?? 'circle'} size={size} color={color} />
        ),
        tabBarActiveTintColor:   '#3B82F6',
        tabBarInactiveTintColor: '#6B7280',
        headerShown:             false,
        tabBarStyle:             { borderTopColor: '#E5E7EB' },
      })}
    >
      <Tab.Screen name="Dashboard"      component={DashboardScreen} />
      <Tab.Screen name="PropertiesTab"  component={PropertiesStack} options={{ title: 'Properties' }} />
      <Tab.Screen name="TenantsTab"     component={TenantsStack}    options={{ title: 'Tenants' }} />
      <Tab.Screen name="MaintenanceTab" component={MaintenanceStack} options={{ title: 'Maintenance' }} />
      <Tab.Screen name="Inspections"    component={InspectionsScreen} />
      <Tab.Screen name="Security"       component={SecurityStack} />
      <Tab.Screen name="Settings"       component={SettingsScreen} />
    </Tab.Navigator>
  </SyncStatusProvider>
);

// ── Root ──────────────────────────────────────────────────────────────────────

const AppNavigator = () => {
  const { isAuthenticated, isLoading } = useAuth();
  const navRef = useRef<NavigationContainerRef<any>>(null);
  const onNavReady = () => setNotificationNavigationRef(navRef);
  if (isLoading) return <AuthLoadingScreen />;
  return (
    <NavigationContainer ref={navRef} onReady={onNavReady}>
      {isAuthenticated ? <MainTabs /> : <AuthStack />}
    </NavigationContainer>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <SyncProvider>
        <ToastProvider>
          <AppNavigator />
        </ToastProvider>
      </SyncProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;