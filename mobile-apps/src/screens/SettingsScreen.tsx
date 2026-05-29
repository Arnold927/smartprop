/**
 * SettingsScreen.tsx  (upgraded sync feedback)
 *
 * Changes:
 *  - Live "Sync Status" card: shows state, last sync time, pending count, dropped count
 *  - Manual sync button changes to spinner while running, shows result via toast
 *  - Dropped actions warning with "Dismiss" option
 *  - syncState colours (idle=green, syncing=blue, error=red)
 */

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Switch,
  Alert, ScrollView, Platform, ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useAuth } from '../services/auth';
import { useSync } from '../services/sync';
import { useToast } from '../components/Toast';
import AsyncStorage from '@react-native-async-storage/async-storage';
import WhatsAppButton from '../components/WhatsAppButton';
import WhatsAppService from '../services/whatsapp';
import { C, R, shadow, haptic } from '../components/DesignSystem';
import { SUCCESS_MESSAGES } from '../services/errors';

const SettingsScreen = ({ navigation }: any) => {
  const { logout, user } = useAuth() as any;
  const {
    syncNow, pendingCount, lastSyncTime, syncState, lastError,
    droppedCount, clearDropped, isOnline,
  } = useSync();
  const toast = useToast();
  const [notifications, setNotifications] = useState(true);
  const [biometric,     setBiometric]     = useState(false);
  const [offlineMode,   setOfflineMode]   = useState(true);
  const [isSyncing,     setIsSyncing]     = useState(false);

  const handleSync = async () => {
    if (!isOnline) { toast.warning('No internet', 'You\'re offline - sync will happen automatically when you reconnect.'); return; }
    setIsSyncing(true);
    try {
      const result = await syncNow();
      if (result.failed > 0 && result.flushed === 0) {
        toast.error('Sync failed', lastError ?? 'Could not reach the server. Please try again.');
      } else if (result.failed > 0) {
        toast.warning('Partially synced', `${result.flushed} item${result.flushed !== 1 ? 's' : ''} uploaded, ${result.failed} still pending.`);
      } else {
        toast.success(SUCCESS_MESSAGES.sync_complete.title, SUCCESS_MESSAGES.sync_complete.message);
      }
    } catch {
      toast.error('Sync failed', 'An unexpected error occurred. Please try again.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleClearCache = async () => {
    Alert.alert('Clear Cache', 'This will remove locally cached data. Unsynced actions will not be affected.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear', style: 'destructive', onPress: async () => {
          await AsyncStorage.removeItem('@smartprop:last_sync');
          toast.success('Cache cleared', 'Locally cached data has been removed.');
        },
      },
    ]);
  };

  const handleLogout = () => {
    haptic.medium();
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: logout },
    ]);
  };

  // Sync status card colour
  const syncStatusConfig = {
    idle:     { color: C.green,   bg: C.greenLight,  icon: 'cloud-done', label: 'Up to date' },
    syncing:  { color: C.blue,    bg: C.blueLight,   icon: 'sync',       label: 'Syncing...' },
    success:  { color: C.green,   bg: C.greenLight,  icon: 'cloud-done', label: 'Just synced' },
    error:    { color: C.red,     bg: '#FEF2F2',     icon: 'cloud-off',  label: 'Sync error' },
  }[syncState] ?? { color: C.textSub, bg: C.bg, icon: 'sync', label: 'Unknown' };

  const sections = [
    {
      title: 'Account',
      items: [
        { icon: 'person-outline', iconColor: C.blue,   title: 'Profile',  subtitle: 'Your account information', chevron: true, onPress: () => {} },
        { icon: 'lock-outline',   iconColor: C.purple, title: 'Security', subtitle: 'Password & authentication', chevron: true, onPress: () => {} },
      ],
    },
    {
      title: 'Preferences',
      items: [
        { icon: 'notifications-none', iconColor: C.amber,  title: 'Push Notifications', subtitle: 'Maintenance and visitor alerts', toggle: true, value: notifications, onToggle: setNotifications },
        { icon: 'fingerprint',        iconColor: C.green,  title: 'Biometric Login',    subtitle: 'Fingerprint or face ID',       toggle: true, value: biometric,     onToggle: setBiometric },
        { icon: 'cloud-off',          iconColor: C.indigo, title: 'Offline Mode',       subtitle: 'Cache data for offline access', toggle: true, value: offlineMode,   onToggle: setOfflineMode },
      ],
    },
    {
      title: 'Support',
      items: [
        { icon: 'help-outline',  iconColor: C.green,   title: 'Help & FAQ',      subtitle: 'Get answers to common questions', chevron: true, onPress: () => {} },
        { icon: 'feedback',      iconColor: C.blue,    title: 'Send Feedback',   subtitle: 'Report issues or suggestions',    chevron: true, onPress: () => {} },
        { icon: 'phone',         iconColor: '#25D366', title: 'WhatsApp Support',subtitle: '+254 724 406 054',                  chevron: true, onPress: () => WhatsAppService.openWhatsAppChat('Hi, I need help with SmartProp.') },
      ],
    },
  ];

  const initials = user ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase() : 'SP';

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      {/* Profile */}
      <View style={[styles.profileCard, shadow(3)]}>
        <View style={styles.profileAvatar}><Text style={styles.profileInitials}>{initials}</Text></View>
        <View style={styles.profileInfo}>
          <Text style={styles.profileName}>{user ? `${user.firstName} ${user.lastName}` : 'Manager'}</Text>
          <Text style={styles.profileEmail}>{user?.email ?? ''}</Text>
          <View style={styles.rolePill}><Text style={styles.roleText}>{user?.role ?? 'Property Manager'}</Text></View>
        </View>
      </View>

      <View style={styles.content}>

        {/* ── Sync Status Card ── */}
        <View style={styles.sectionLabel2Wrap}>
          <Text style={styles.sectionLabel}>Data Sync</Text>
        </View>
        <View style={[styles.syncCard, shadow(2)]}>
          {/* Status row */}
          <View style={styles.syncTopRow}>
            <View style={[styles.syncIconBox, { backgroundColor: syncStatusConfig.bg }]}>
              <Icon name={syncStatusConfig.icon} size={18} color={syncStatusConfig.color} />
            </View>
            <View style={styles.syncInfo}>
              <Text style={[styles.syncStatus, { color: syncStatusConfig.color }]}>{syncStatusConfig.label}</Text>
              <Text style={styles.syncSub}>
                {!isOnline
                  ? 'Offline - changes saved locally'
                  : lastSyncTime
                    ? `Last sync: ${new Date(lastSyncTime).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                    : 'Never synced'
                }
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.syncNowBtn, { backgroundColor: `${C.blue}15` }]}
              onPress={handleSync}
              disabled={isSyncing || !isOnline}
            >
              {isSyncing
                ? <ActivityIndicator size="small" color={C.blue} />
                : <Icon name="sync" size={18} color={C.blue} />
              }
            </TouchableOpacity>
          </View>

          {/* Pending count */}
          {pendingCount > 0 && (
            <View style={styles.syncMetaRow}>
              <View style={[styles.syncMetaDot, { backgroundColor: C.amber }]} />
              <Text style={styles.syncMetaText}>
                {pendingCount} action{pendingCount !== 1 ? 's' : ''} queued - will upload automatically when online
              </Text>
            </View>
          )}

          {/* Error detail */}
          {syncState === 'error' && lastError && (
            <View style={[styles.syncMetaRow, { backgroundColor: '#FEF2F2', borderRadius: R.sm, padding: 8, marginTop: 8 }]}>
              <Icon name="error-outline" size={14} color={C.red} />
              <Text style={[styles.syncMetaText, { color: '#991B1B' }]}>{lastError}</Text>
            </View>
          )}

          {/* Dropped count warning */}
          {droppedCount > 0 && (
            <View style={styles.droppedBanner}>
              <Icon name="warning" size={14} color="#92400E" />
              <Text style={styles.droppedText}>
                {droppedCount} offline action{droppedCount !== 1 ? 's were' : ' was'} permanently dropped after repeated failures.
              </Text>
              <TouchableOpacity onPress={clearDropped}>
                <Text style={styles.droppedDismiss}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Clear cache */}
          <TouchableOpacity style={styles.clearCacheRow} onPress={handleClearCache}>
            <Icon name="delete-sweep" size={15} color={C.textSub} />
            <Text style={styles.clearCacheText}>Clear cached data</Text>
          </TouchableOpacity>
        </View>

        {/* Other settings */}
        {sections.map((section, si) => (
          <View key={si} style={styles.section}>
            <Text style={styles.sectionLabel}>{section.title}</Text>
            <View style={[styles.sectionCard, shadow(1)]}>
              {section.items.map((item: any, ii) => (
                <TouchableOpacity
                  key={ii}
                  style={[styles.row, ii < section.items.length - 1 && styles.rowBorder]}
                  onPress={item.toggle ? undefined : item.onPress}
                  disabled={item.toggle}
                  activeOpacity={0.7}
                >
                  <View style={[styles.iconPill, { backgroundColor: `${item.iconColor}15` }]}>
                    <Icon name={item.icon} size={20} color={item.iconColor} />
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{item.title}</Text>
                    <Text style={styles.rowSub}>{item.subtitle}</Text>
                  </View>
                  {item.toggle
                    ? <Switch value={item.value} onValueChange={item.onToggle} trackColor={{ false: C.border, true: `${C.blue}60` }} thumbColor={item.value ? C.blue : C.surface} />
                    : item.chevron ? <Icon name="chevron-right" size={20} color={C.border} /> : null
                  }
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {/* Logout */}
        <TouchableOpacity style={[styles.logoutBtn, shadow(1)]} onPress={handleLogout} activeOpacity={0.85}>
          <Icon name="logout" size={18} color={C.red} />
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>

        <Text style={styles.version}>SmartProp Mobile v1.0.0 (c) 2025</Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: C.bg },
  header:          { backgroundColor: C.dark, paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 56 : 20, paddingBottom: 24 },
  headerTitle:     { fontSize: 26, fontWeight: '800', color: 'white', letterSpacing: -0.5 },
  profileCard:     { marginHorizontal: 16, marginTop: -1, backgroundColor: C.surface, borderRadius: R.xl, padding: 16, flexDirection: 'row', alignItems: 'center' },
  profileAvatar:   { width: 56, height: 56, borderRadius: 28, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  profileInitials: { fontSize: 20, fontWeight: '800', color: 'white' },
  profileInfo:     { flex: 1 },
  profileName:     { fontSize: 17, fontWeight: '700', color: C.ink },
  profileEmail:    { fontSize: 13, color: C.textSub, marginTop: 1, marginBottom: 6 },
  rolePill:        { alignSelf: 'flex-start', backgroundColor: C.blueLight, paddingHorizontal: 10, paddingVertical: 3, borderRadius: R.pill },
  roleText:        { fontSize: 11, fontWeight: '600', color: C.blue },
  content:         { padding: 16 },
  sectionLabel2Wrap: { marginBottom: 8 },
  sectionLabel:    { fontSize: 11, fontWeight: '700', color: C.textMuted, letterSpacing: 0.8, marginBottom: 8, marginLeft: 4 },
  section:         { marginBottom: 20 },
  sectionCard:     { backgroundColor: C.surface, borderRadius: R.xl, overflow: 'hidden' },
  row:             { flexDirection: 'row', alignItems: 'center', padding: 14 },
  rowBorder:       { borderBottomWidth: 1, borderBottomColor: C.borderLight },
  iconPill:        { width: 38, height: 38, borderRadius: R.sm, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  rowText:         { flex: 1 },
  rowTitle:        { fontSize: 15, fontWeight: '500', color: C.text },
  rowSub:          { fontSize: 12, color: C.textMuted, marginTop: 1 },

  // Sync card
  syncCard:        { backgroundColor: C.surface, borderRadius: R.xl, padding: 16, marginBottom: 20 },
  syncTopRow:      { flexDirection: 'row', alignItems: 'center', marginBottom: 0 },
  syncIconBox:     { width: 40, height: 40, borderRadius: R.md, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  syncInfo:        { flex: 1 },
  syncStatus:      { fontSize: 15, fontWeight: '700' },
  syncSub:         { fontSize: 12, color: C.textSub, marginTop: 2 },
  syncNowBtn:      { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  syncMetaRow:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  syncMetaDot:     { width: 6, height: 6, borderRadius: 3 },
  syncMetaText:    { fontSize: 12, color: C.textSub, flex: 1 },
  droppedBanner:   { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: C.amberLight, borderRadius: R.sm, padding: 10, marginTop: 10, borderWidth: 1, borderColor: '#FDE68A' },
  droppedText:     { fontSize: 12, color: C.amberDark, flex: 1 },
  droppedDismiss:  { fontSize: 12, color: C.amberDark, fontWeight: '700' },
  clearCacheRow:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.borderLight },
  clearCacheText:  { fontSize: 13, color: C.textSub },

  logoutBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface, borderRadius: R.xl, padding: 16, borderWidth: 1, borderColor: '#FEE2E2', gap: 8, marginBottom: 20 },
  logoutText:      { fontSize: 16, fontWeight: '700', color: C.red },
  version:         { textAlign: 'center', fontSize: 12, color: C.textMuted, marginBottom: 32 },
});

export default SettingsScreen;