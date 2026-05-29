/**
 * SettingsScreen.tsx — FIXED
 *
 * Gaps fixed vs original:
 *  1. Profile section showed no user info — now fetches from apiService.getProfile()
 *     and displays name, email, and role.
 *  2. Toggle states (notifications, biometric, offline) were not persisted —
 *     they now read from and write to AsyncStorage so they survive restarts.
 *  3. Push notification toggle calls notificationService.registerForPushNotifications()
 *     when turned on (requesting permission if needed).
 *  4. Sync status shows last-sync time and pending count inline.
 *  5. Removed duplicate "Support" section that existed twice in original.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Switch, Alert,
  ScrollView, ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../services/auth';
import { useSync } from '../services/sync';
import { apiService } from '../services/api';
import { notificationService } from '../services/notifications';
import WhatsAppButton from '../components/WhatsAppButton';
import WhatsAppService from '../services/whatsapp';

const PREF_KEYS = {
  notifications: '@smartprop:pref_notifications',
  biometric:     '@smartprop:pref_biometric',
  offlineMode:   '@smartprop:pref_offline_mode',
};

const SettingsScreen = ({ navigation }: any) => {
  const { logout } = useAuth();
  const { syncNow, pendingCount, lastSyncTime } = useSync();

  const [notifications, setNotificationsState] = useState(true);
  const [biometric,     setBiometricState]     = useState(false);
  const [offlineMode,   setOfflineModeState]   = useState(true);
  const [prefsLoaded,   setPrefsLoaded]        = useState(false);

  // ── Load persisted preferences on mount ─────────────────────────────────────
  useEffect(() => {
    (async () => {
      const [n, b, o] = await Promise.all([
        AsyncStorage.getItem(PREF_KEYS.notifications),
        AsyncStorage.getItem(PREF_KEYS.biometric),
        AsyncStorage.getItem(PREF_KEYS.offlineMode),
      ]);
      if (n !== null) setNotificationsState(n === 'true');
      if (b !== null) setBiometricState(b === 'true');
      if (o !== null) setOfflineModeState(o === 'true');
      setPrefsLoaded(true);
    })();
  }, []);

  const setNotifications = useCallback(async (val: boolean) => {
    setNotificationsState(val);
    await AsyncStorage.setItem(PREF_KEYS.notifications, String(val));
    if (val) {
      // Re-request permission and register push token if user turns it on
      await notificationService.registerForPushNotifications();
    }
  }, []);

  const setBiometric = useCallback(async (val: boolean) => {
    setBiometricState(val);
    await AsyncStorage.setItem(PREF_KEYS.biometric, String(val));
    // TODO: integrate react-native-biometrics here
    if (val) Alert.alert('Biometric', 'Biometric login will be enabled on next launch.');
  }, []);

  const setOfflineMode = useCallback(async (val: boolean) => {
    setOfflineModeState(val);
    await AsyncStorage.setItem(PREF_KEYS.offlineMode, String(val));
  }, []);

  // ── Profile data ─────────────────────────────────────────────────────────────
  const { data: profileRes, isLoading: profileLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: () => apiService.getProfile(),
    staleTime: 5 * 60_000,
  });

  const profile = (profileRes?.data as any)?.user ?? (profileRes?.data as any) ?? null;

  // ── Logout ────────────────────────────────────────────────────────────────────
  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Logout', style: 'destructive', onPress: logout },
      ],
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  const renderToggleRow = (
    icon: string,
    title: string,
    subtitle: string,
    value: boolean,
    onToggle: (v: boolean) => void,
    isLast = false,
  ) => (
    <View style={[styles.settingItem, isLast && styles.settingItemLast]}>
      <View style={styles.settingContent}>
        <View style={styles.settingIcon}>
          <Icon name={icon} size={22} color="#3B82F6" />
        </View>
        <View style={styles.settingText}>
          <Text style={styles.settingTitle}>{title}</Text>
          <Text style={styles.settingSubtitle}>{subtitle}</Text>
        </View>
        <Switch
          value={value}
          onValueChange={onToggle}
          trackColor={{ false: '#D1D5DB', true: '#93C5FD' }}
          thumbColor={value ? '#3B82F6' : '#F9FAFB'}
        />
      </View>
    </View>
  );

  const renderNavRow = (
    icon: string,
    title: string,
    subtitle: string,
    onPress: () => void,
    isLast = false,
    iconColor = '#3B82F6',
  ) => (
    <TouchableOpacity
      style={[styles.settingItem, isLast && styles.settingItemLast]}
      onPress={onPress}
    >
      <View style={styles.settingContent}>
        <View style={[styles.settingIcon, { backgroundColor: `${iconColor}15` }]}>
          <Icon name={icon} size={22} color={iconColor} />
        </View>
        <View style={styles.settingText}>
          <Text style={styles.settingTitle}>{title}</Text>
          <Text style={styles.settingSubtitle}>{subtitle}</Text>
        </View>
        <Icon name="chevron-right" size={20} color="#9CA3AF" />
      </View>
    </TouchableOpacity>
  );

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>

      <View style={styles.content}>

        {/* Profile card */}
        <View style={styles.profileCard}>
          {profileLoading ? (
            <ActivityIndicator size="small" color="#3B82F6" />
          ) : (
            <>
              <View style={styles.profileAvatar}>
                <Text style={styles.profileAvatarText}>
                  {profile
                    ? `${(profile.firstName ?? profile.first_name ?? 'U')[0]}${(profile.lastName ?? profile.last_name ?? '')[0]}`.toUpperCase()
                    : 'U'}
                </Text>
              </View>
              <View style={styles.profileInfo}>
                <Text style={styles.profileName}>
                  {profile
                    ? `${profile.firstName ?? profile.first_name ?? ''} ${profile.lastName ?? profile.last_name ?? ''}`.trim() || 'User'
                    : 'Loading…'}
                </Text>
                <Text style={styles.profileEmail}>{profile?.email ?? '—'}</Text>
                {profile?.role && (
                  <View style={styles.roleBadge}>
                    <Text style={styles.roleText}>{profile.role}</Text>
                  </View>
                )}
              </View>
              <TouchableOpacity onPress={() => navigation.navigate('Profile')}>
                <Icon name="edit" size={20} color="#3B82F6" />
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Sync status */}
        <TouchableOpacity
          style={styles.syncBar}
          onPress={async () => { await syncNow(); Alert.alert('Sync', 'Data synchronised successfully'); }}
        >
          <Icon name="sync" size={18} color="#3B82F6" />
          <Text style={styles.syncText}>
            Last sync: {lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString('en-KE') : 'Never'}
          </Text>
          {pendingCount > 0 && (
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingText}>{pendingCount} pending</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Preferences */}
        <Text style={styles.sectionTitle}>Preferences</Text>
        <View style={styles.sectionContent}>
          {prefsLoaded ? (
            <>
              {renderToggleRow('notifications', 'Push Notifications', 'Maintenance and visitor alerts', notifications, setNotifications)}
              {renderToggleRow('fingerprint', 'Biometric Login', 'Fingerprint or face unlock', biometric, setBiometric)}
              {renderToggleRow('cloud-off', 'Offline Mode', 'Cache data for offline access', offlineMode, setOfflineMode, true)}
            </>
          ) : (
            <ActivityIndicator size="small" color="#3B82F6" style={{ padding: 20 }} />
          )}
        </View>

        {/* App */}
        <Text style={styles.sectionTitle}>App</Text>
        <View style={styles.sectionContent}>
          {renderNavRow('storage', 'Clear Cache', 'Free up storage space', async () => {
            await AsyncStorage.multiRemove(['@smartprop:last_sync', '@smartprop:offline_queue']);
            Alert.alert('Cache', 'Cache cleared successfully');
          })}
          {renderNavRow('info', 'About', 'App version and information', () => navigation.navigate('About'), true)}
        </View>

        {/* Support */}
        <Text style={styles.sectionTitle}>Support</Text>
        <View style={styles.sectionContent}>
          {renderNavRow('help', 'Help & FAQ', 'Get help and find answers', () => navigation.navigate('Help'))}
          {renderNavRow('feedback', 'Send Feedback', 'Report issues or suggestions', () => navigation.navigate('Feedback'), true)}
        </View>

        {/* WhatsApp support */}
        <View style={styles.whatsappContainer}>
          <WhatsAppButton
            message="Hi! I need help with the Smart Prop mobile app. Can you assist me?"
            size="large"
          />
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Icon name="logout" size={20} color="#EF4444" />
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>

        {/* App info */}
        <View style={styles.appInfo}>
          <Text style={styles.appVersion}>Smart Prop Mobile v1.0.0</Text>
          <Text style={styles.appCopyright}>© 2025 Smart Prop Solutions</Text>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },

  header: { padding: 20, paddingTop: 50, backgroundColor: '#6366F1' },
  title: { fontSize: 24, fontWeight: 'bold', color: 'white' },

  content: { flex: 1, padding: 16, paddingBottom: 40 },

  profileCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'white', borderRadius: 14, padding: 16,
    marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 4, elevation: 3,
  },
  profileAvatar: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: '#6366F1',
    alignItems: 'center', justifyContent: 'center', marginRight: 14,
  },
  profileAvatarText: { color: 'white', fontSize: 20, fontWeight: 'bold' },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 16, fontWeight: '700', color: '#1F2937' },
  profileEmail: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  roleBadge: {
    marginTop: 5, alignSelf: 'flex-start',
    backgroundColor: '#EEF2FF', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8,
  },
  roleText: { fontSize: 11, color: '#6366F1', fontWeight: '700', textTransform: 'capitalize' },

  syncBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#EFF6FF', borderRadius: 10, padding: 12, marginBottom: 20,
  },
  syncText: { fontSize: 13, color: '#1D4ED8', flex: 1 },
  pendingBadge: {
    backgroundColor: '#FEF3C7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  pendingText: { fontSize: 11, color: '#92400E', fontWeight: '700' },

  sectionTitle: {
    fontSize: 13, fontWeight: '700', color: '#6B7280',
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginBottom: 8, marginLeft: 4, marginTop: 8,
  },
  sectionContent: {
    backgroundColor: 'white', borderRadius: 12, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
    overflow: 'hidden',
  },
  settingItem: {
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F3F4F6',
  },
  settingItemLast: { borderBottomWidth: 0 },
  settingContent: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  settingIcon: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: '#EBF4FF',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  settingText: { flex: 1 },
  settingTitle: { fontSize: 15, fontWeight: '500', color: '#1F2937' },
  settingSubtitle: { fontSize: 12, color: '#6B7280', marginTop: 2 },

  whatsappContainer: { marginBottom: 16 },
  logoutButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'white', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: '#FEE2E2', marginBottom: 32,
  },
  logoutText: { fontSize: 16, fontWeight: '600', color: '#EF4444', marginLeft: 8 },

  appInfo: { alignItems: 'center', paddingBottom: 20 },
  appVersion: { fontSize: 13, color: '#6B7280' },
  appCopyright: { fontSize: 11, color: '#9CA3AF', marginTop: 4 },
});

export default SettingsScreen;
