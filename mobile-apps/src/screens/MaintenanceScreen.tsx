/**
 * MaintenanceScreen.tsx  (upgraded error handling)
 *
 * Changes:
 *  - Field-level inline validation errors (not Alert)
 *  - useToast replaces Alert.alert for success and non-critical errors
 *  - onError receives the full API error and shows the userMessage
 *  - Offline queuing shows the specific OFFLINE_MESSAGES copy
 *  - InlineSyncIndicator in header for persistent sync status
 *  - Retry on list load error uses ErrorState with specific message
 */

import React, { useState, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, TextInput, Modal, ScrollView,
  Animated, Platform, ActivityIndicator,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { apiService } from '../services/api';
import { useSync } from '../services/sync';
import { useToast } from '../components/Toast';
import { InlineSyncIndicator } from '../components/SyncStatusBar';
import {
  validateMaintenanceForm,
  OFFLINE_MESSAGES,
  SUCCESS_MESSAGES,
  classifyError,
} from '../services/errors';
import {
  C, R, shadow, haptic,
  SkeletonCard, StatusPill, EmptyState, ErrorState, PressableCard,
} from '../components/DesignSystem';

const STATUS_TABS = ['all', 'pending', 'in_progress', 'completed'] as const;
type StatusTab = typeof STATUS_TABS[number];
const TAB_LABELS: Record<StatusTab, string> = {
  all: 'All', pending: 'Pending', in_progress: 'In Progress', completed: 'Done',
};
const PRIORITY_CONFIG: Record<string, { color: string; icon: string }> = {
  low:    { color: C.green,   icon: 'arrow-downward' },
  medium: { color: C.amber,   icon: 'remove' },
  high:   { color: C.red,     icon: 'arrow-upward' },
  urgent: { color: '#7C3AED', icon: 'priority-high' },
};

const MaintenanceScreen = ({ navigation }: any) => {
  const queryClient = useQueryClient();
  const { isOnline, pendingCount, lastSyncTime, syncState, syncNow, queueOfflineAction } = useSync();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<StatusTab>('all');
  const [showModal, setShowModal]  = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const fabScale = useRef(new Animated.Value(1)).current;
  const [form, setForm] = useState({
    title: '', description: '', priority: 'medium' as string, unitId: '',
  });

  const { data: requests = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['maintenance-requests'],
    queryFn: async () => {
      const res = await apiService.getMaintenanceRequests();
      if (!res.success) throw new Error(res.userMessage ?? res.error);
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const filtered = useMemo(
    () => activeTab === 'all' ? requests : requests.filter((r: any) => r.status === activeTab),
    [requests, activeTab],
  );

  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      if (!isOnline) {
        const id = await queueOfflineAction('maintenance_request', payload);
        return { queued: true, id };
      }
      const res = await apiService.createMaintenanceRequest(payload);
      if (!res.success) throw { userMessage: res.userMessage, errorCode: res.errorCode };
      return res.data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['maintenance-requests'] });
      setShowModal(false);
      setForm({ title: '', description: '', priority: 'medium', unitId: '' });
      setFieldErrors({});
      haptic.medium();
      if (data?.queued) {
        const msg = OFFLINE_MESSAGES.maintenance_request;
        toast.offline(msg.title, msg.message);
      } else {
        const msg = SUCCESS_MESSAGES.maintenance_request;
        toast.success(msg.title, msg.message);
      }
    },
    onError: (err: any) => {
      const msg = err?.userMessage ?? 'Could not submit the maintenance request. Please try again.';
      toast.error('Submission failed', msg);
    },
  });

  const handleCreate = () => {
    const validation = validateMaintenanceForm(form);
    if (!validation.valid) {
      setFieldErrors(validation.errors);
      haptic.medium();
      return;
    }
    setFieldErrors({});
    createMutation.mutate(form);
  };

  const onFabPress = () => {
    haptic.light();
    Animated.sequence([
      Animated.spring(fabScale, { toValue: 0.88, useNativeDriver: true, speed: 50, bounciness: 0 }),
      Animated.spring(fabScale, { toValue: 1,    useNativeDriver: true, speed: 40, bounciness: 12 }),
    ]).start(() => setShowModal(true));
  };

  // Specific error message for the list load failure
  const listErrorMessage = (() => {
    const raw = (error as any)?.message ?? '';
    if (raw.includes('timeout') || raw.includes('timed out')) return 'Request timed out loading requests.';
    if (!isOnline) return 'You're offline — showing cached data.';
    return 'Could not load maintenance requests.';
  })();

  const renderItem = ({ item }: any) => {
    const pConf = PRIORITY_CONFIG[item.priority] ?? { color: C.textSub, icon: 'remove' };
    return (
      <PressableCard
        onPress={() => navigation.navigate('MaintenanceDetail', { requestId: item.id })}
        style={[styles.card, shadow(2), { borderLeftColor: pConf.color, borderLeftWidth: 4 }]}
      >
        <View style={styles.cardTop}>
          <View style={[styles.cardIconBox, { backgroundColor: `${pConf.color}15` }]}>
            <Icon name="build" size={18} color={pConf.color} />
          </View>
          <View style={styles.cardMain}>
            <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.cardUnit}>Unit {item.unitNumber ?? item.unitId ?? 'N/A'}</Text>
          </View>
          <StatusPill status={item.status ?? 'pending'} />
        </View>
        <View style={styles.cardFooter}>
          <View style={styles.priorityRow}>
            <Icon name={pConf.icon} size={13} color={pConf.color} />
            <Text style={[styles.priorityLabel, { color: pConf.color }]}>
              {item.priority?.toUpperCase()}
            </Text>
          </View>
          <Text style={styles.cardDate}>
            {item.createdAt ? new Date(item.createdAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }) : ''}
          </Text>
        </View>
      </PressableCard>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Maintenance</Text>
          <InlineSyncIndicator
            isLoading={syncState === 'syncing'}
            lastSyncTime={lastSyncTime}
            pendingCount={pendingCount}
            isOnline={isOnline}
            onSync={syncNow}
          />
        </View>
        {!isOnline && (
          <View style={styles.offlinePill}>
            <Icon name="wifi-off" size={12} color="white" />
            <Text style={styles.offlinePillText}>Offline</Text>
          </View>
        )}
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        {STATUS_TABS.map((tab) => {
          const count = tab === 'all' ? requests.length : requests.filter((r: any) => r.status === tab).length;
          return (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && styles.tabActive]}
              onPress={() => { haptic.light(); setActiveTab(tab); }}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                {TAB_LABELS[tab]}
              </Text>
              {count > 0 && (
                <View style={[styles.tabCount, activeTab === tab && styles.tabCountActive]}>
                  <Text style={[styles.tabCountText, activeTab === tab && styles.tabCountTextActive]}>{count}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Content */}
      {isLoading && requests.length === 0 ? (
        <ScrollView contentContainerStyle={styles.listPad}>
          {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} lines={3} />)}
        </ScrollView>
      ) : isError ? (
        <ErrorState onRetry={refetch} message={listErrorMessage} />
      ) : (
        <FlatList
          data={filtered}
          renderItem={renderItem}
          keyExtractor={(item) => String(item.id)}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={C.amber} />}
          contentContainerStyle={filtered.length === 0 ? styles.emptyContainer : styles.listPad}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <EmptyState
              icon="build"
              title={activeTab === 'all' ? 'No requests yet' : `No ${TAB_LABELS[activeTab].toLowerCase()} requests`}
              subtitle="Tap the + button to log a new maintenance request."
              color={C.amber}
            />
          }
        />
      )}

      {/* FAB */}
      <Animated.View style={[styles.fabWrap, { transform: [{ scale: fabScale }] }]}>
        <TouchableOpacity style={styles.fab} onPress={onFabPress} activeOpacity={1}>
          <Icon name="add" size={28} color="white" />
        </TouchableOpacity>
      </Animated.View>

      {/* Create Modal */}
      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowModal(false)}>
        <View style={styles.modal}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => { setShowModal(false); setFieldErrors({}); }} style={styles.modalClose}>
              <Icon name="close" size={22} color={C.textSub} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>New Request</Text>
            <TouchableOpacity onPress={handleCreate} disabled={createMutation.isPending} style={styles.modalSubmit}>
              {createMutation.isPending
                ? <ActivityIndicator color="white" size="small" />
                : <Text style={styles.modalSubmitText}>Submit</Text>
              }
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            {/* Title */}
            <Text style={styles.fieldLabel}>What needs fixing? <Text style={{ color: C.red }}>*</Text></Text>
            <View style={[styles.inputWrap, fieldErrors.title && styles.inputError]}>
              <TextInput
                style={styles.input}
                value={form.title}
                onChangeText={(v) => { setForm((f) => ({ ...f, title: v })); setFieldErrors((e) => ({ ...e, title: '' })); }}
                placeholder="e.g. Leaking tap in Unit A3 bathroom"
                placeholderTextColor={C.textMuted}
              />
            </View>
            {fieldErrors.title ? <Text style={styles.fieldError}>{fieldErrors.title}</Text> : null}

            {/* Description */}
            <Text style={styles.fieldLabel}>Describe the issue <Text style={{ color: C.red }}>*</Text></Text>
            <View style={[styles.inputWrap, styles.inputMultiline, fieldErrors.description && styles.inputError]}>
              <TextInput
                style={[styles.input, { height: 90, textAlignVertical: 'top', paddingTop: 12 }]}
                value={form.description}
                onChangeText={(v) => { setForm((f) => ({ ...f, description: v })); setFieldErrors((e) => ({ ...e, description: '' })); }}
                placeholder="When did it start? How severe is it? Any safety risk?"
                placeholderTextColor={C.textMuted}
                multiline
              />
            </View>
            {fieldErrors.description ? <Text style={styles.fieldError}>{fieldErrors.description}</Text> : null}

            {/* Unit */}
            <Text style={styles.fieldLabel}>Unit / Location</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                value={form.unitId}
                onChangeText={(v) => setForm((f) => ({ ...f, unitId: v }))}
                placeholder="e.g. A12, Penthouse, Corridor B"
                placeholderTextColor={C.textMuted}
              />
            </View>

            {/* Priority */}
            <Text style={styles.fieldLabel}>How urgent is this?</Text>
            <View style={styles.priorityGrid}>
              {(['low', 'medium', 'high', 'urgent'] as const).map((p) => {
                const conf   = PRIORITY_CONFIG[p];
                const active = form.priority === p;
                return (
                  <TouchableOpacity
                    key={p}
                    style={[styles.priorityChip, active && { backgroundColor: `${conf.color}18`, borderColor: conf.color }]}
                    onPress={() => { haptic.light(); setForm((f) => ({ ...f, priority: p })); }}
                  >
                    <Icon name={conf.icon} size={14} color={active ? conf.color : C.textMuted} />
                    <Text style={[styles.priorityChipText, active && { color: conf.color, fontWeight: '700' }]}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Offline notice */}
            {!isOnline && (
              <View style={styles.offlineNotice}>
                <Icon name="cloud-upload" size={16} color="#3730A3" />
                <Text style={styles.offlineNoticeText}>
                  You're offline. This request will be saved to your device and uploaded automatically when you reconnect.
                </Text>
              </View>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: C.bg },
  header:             { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.dark, paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 56 : 20, paddingBottom: 18 },
  headerTitle:        { fontSize: 26, fontWeight: '800', color: 'white', letterSpacing: -0.5, marginBottom: 4 },
  offlinePill:        { flexDirection: 'row', alignItems: 'center', backgroundColor: C.amber, paddingHorizontal: 10, paddingVertical: 5, borderRadius: R.pill, gap: 4 },
  offlinePillText:    { fontSize: 11, fontWeight: '700', color: 'white' },
  tabBar:             { flexDirection: 'row', backgroundColor: C.surface, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border, gap: 6 },
  tab:                { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: R.pill, gap: 5, backgroundColor: C.bg },
  tabActive:          { backgroundColor: `${C.amber}18` },
  tabText:            { fontSize: 13, color: C.textSub, fontWeight: '500' },
  tabTextActive:      { color: C.amber, fontWeight: '700' },
  tabCount:           { width: 18, height: 18, borderRadius: 9, backgroundColor: C.border, alignItems: 'center', justifyContent: 'center' },
  tabCountActive:     { backgroundColor: `${C.amber}30` },
  tabCountText:       { fontSize: 10, fontWeight: '700', color: C.textSub },
  tabCountTextActive: { color: C.amber },
  listPad:            { padding: 16 },
  emptyContainer:     { flexGrow: 1 },
  card:               { backgroundColor: C.surface, borderRadius: R.lg, padding: 14, marginBottom: 10 },
  cardTop:            { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  cardIconBox:        { width: 38, height: 38, borderRadius: R.sm, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  cardMain:           { flex: 1 },
  cardTitle:          { fontSize: 15, fontWeight: '600', color: C.text, marginBottom: 2 },
  cardUnit:           { fontSize: 12, color: C.textSub },
  cardFooter:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  priorityRow:        { flexDirection: 'row', alignItems: 'center', gap: 3 },
  priorityLabel:      { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  cardDate:           { fontSize: 12, color: C.textMuted },
  fabWrap:            { position: 'absolute', bottom: 28, right: 20 },
  fab:                { width: 56, height: 56, borderRadius: 28, backgroundColor: C.amber, alignItems: 'center', justifyContent: 'center', ...shadow(4) as any },
  modal:              { flex: 1, backgroundColor: C.surface },
  modalHandle:        { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  modalHeader:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  modalClose:         { padding: 4 },
  modalTitle:         { fontSize: 18, fontWeight: '700', color: C.ink },
  modalSubmit:        { paddingHorizontal: 16, paddingVertical: 6, backgroundColor: C.amber, borderRadius: R.pill, minWidth: 72, alignItems: 'center', minHeight: 32, justifyContent: 'center' },
  modalSubmitText:    { fontSize: 14, fontWeight: '700', color: 'white' },
  modalBody:          { flex: 1, padding: 16 },
  fieldLabel:         { fontSize: 13, fontWeight: '600', color: C.textSub, marginBottom: 6, marginTop: 20, textTransform: 'uppercase', letterSpacing: 0.4 },
  inputWrap:          { borderWidth: 1.5, borderColor: C.border, borderRadius: R.md, backgroundColor: C.bg, paddingHorizontal: 14 },
  inputMultiline:     { paddingBottom: 4 },
  inputError:         { borderColor: C.red, backgroundColor: '#FEF2F2' },
  input:              { fontSize: 15, color: C.ink, height: 50 },
  fieldError:         { fontSize: 12, color: C.red, marginTop: 5, marginLeft: 2 },
  priorityGrid:       { flexDirection: 'row', gap: 8 },
  priorityChip:       { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 10, borderRadius: R.md, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.bg },
  priorityChipText:   { fontSize: 13, color: C.textSub },
  offlineNotice:      { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: C.indigoLight, padding: 12, borderRadius: R.md, marginTop: 20, borderWidth: 1, borderColor: '#C7D2FE' },
  offlineNoticeText:  { fontSize: 13, color: '#3730A3', flex: 1, lineHeight: 18 },
});

export default MaintenanceScreen;
