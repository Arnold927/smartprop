/**
 * InspectionsScreen.tsx  (upgraded error handling)
 */

import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, FlatList, RefreshControl, Platform, ActivityIndicator,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { apiService } from '../services/api';
import { useSync } from '../services/sync';
import { useToast } from '../components/Toast';
import { InlineSyncIndicator } from '../components/SyncStatusBar';
import { OFFLINE_MESSAGES, SUCCESS_MESSAGES } from '../services/errors';
import { C, R, shadow, SkeletonCard, StatusPill, EmptyState, ErrorState, PressableCard, haptic } from '../components/DesignSystem';

const CONDITION_OPTIONS = [
  { value: 'excellent', label: 'Excellent', color: C.green },
  { value: 'good',      label: 'Good',      color: C.blue },
  { value: 'fair',      label: 'Fair',      color: C.amber },
  { value: 'poor',      label: 'Poor',      color: C.red },
] as const;

const INSPECTION_TYPES = [
  { value: 'routine',   label: 'Routine',   icon: 'schedule' },
  { value: 'moveIn',    label: 'Move-in',   icon: 'home' },
  { value: 'moveOut',   label: 'Move-out',  icon: 'exit-to-app' },
  { value: 'emergency', label: 'Emergency', icon: 'warning' },
] as const;

const InspectionsScreen = ({ navigation }: any) => {
  const queryClient = useQueryClient();
  const { isOnline, pendingCount, lastSyncTime, syncState, syncNow, queueOfflineAction } = useSync();
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    propertyId: '', inspectionType: 'routine', notes: '', condition: 'good',
  });

  const { data: properties = [] } = useQuery({
    queryKey: ['properties'],
    queryFn: async () => {
      const res = await apiService.getProperties();
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const { data: inspections = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['inspections'],
    queryFn: async () => {
      const res = await apiService.getInspections();
      if (!res.success) throw new Error(res.userMessage ?? res.error);
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      if (!isOnline) {
        const id = await queueOfflineAction('inspection', payload);
        return { queued: true, id };
      }
      const res = await apiService.createInspection(payload);
      if (!res.success) throw { userMessage: res.userMessage, errorCode: res.errorCode };
      return res.data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['inspections'] });
      setShowForm(false);
      setForm({ propertyId: '', inspectionType: 'routine', notes: '', condition: 'good' });
      setFieldErrors({});
      haptic.medium();
      if (data?.queued) {
        const msg = OFFLINE_MESSAGES.inspection;
        toast.offline(msg.title, msg.message);
      } else {
        const msg = SUCCESS_MESSAGES.inspection;
        toast.success(msg.title, msg.message);
      }
    },
    onError: (err: any) => {
      toast.error('Save failed', err?.userMessage ?? 'Could not save the inspection. Please try again.');
    },
  });

  const handleSubmit = () => {
    const errors: Record<string, string> = {};
    if (!form.propertyId) errors.propertyId = 'Please select a property.';
    if (!form.notes.trim()) errors.notes = 'Inspection notes are required — describe what you observed.';
    else if (form.notes.trim().length < 10) errors.notes = 'Notes are too short — please add more detail.';
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      haptic.medium();
      return;
    }
    createMutation.mutate({ ...form, timestamp: new Date().toISOString(), status: 'completed' });
  };

  const listErrorMsg = (() => {
    const raw = (error as any)?.message ?? '';
    if (!isOnline) return 'You're offline. Showing cached inspections.';
    if (raw.includes('timeout')) return 'Loading timed out. Pull down to retry.';
    return 'Could not load inspections.';
  })();

  const renderHistoryItem = ({ item }: any) => {
    const cond = CONDITION_OPTIONS.find((c) => c.value === item.condition);
    const propName = (properties as any[]).find((p: any) => String(p.id) === String(item.propertyId))?.name
      ?? `Property ${item.propertyId}`;
    return (
      <View style={[styles.histCard, shadow(2)]}>
        <View style={styles.histRow}>
          <Text style={styles.histType}>{item.inspectionType ?? item.category ?? 'Inspection'}</Text>
          {cond && (
            <View style={[styles.condBadge, { backgroundColor: `${cond.color}18` }]}>
              <View style={[styles.condDot, { backgroundColor: cond.color }]} />
              <Text style={[styles.condBadgeText, { color: cond.color }]}>{cond.label}</Text>
            </View>
          )}
        </View>
        <View style={styles.histPropRow}>
          <Icon name="home" size={13} color={C.textMuted} />
          <Text style={styles.histProp} numberOfLines={1}>{propName}</Text>
        </View>
        <Text style={styles.histNotes} numberOfLines={2}>{item.notes}</Text>
        <Text style={styles.histDate}>
          {item.createdAt ? new Date(item.createdAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Inspections</Text>
          <InlineSyncIndicator
            isLoading={syncState === 'syncing'}
            lastSyncTime={lastSyncTime}
            pendingCount={pendingCount}
            isOnline={isOnline}
            onSync={syncNow}
          />
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowForm(true)}>
          <Icon name="add" size={24} color="white" />
        </TouchableOpacity>
      </View>

      {isLoading && inspections.length === 0 ? (
        <View style={{ padding: 16 }}>{[0,1,2].map((i) => <SkeletonCard key={i} />)}</View>
      ) : isError && !isOnline ? (
        /* Offline with no cache — gentle message */
        <EmptyState icon="wifi-off" title="You're offline" subtitle="Cached inspections will appear here once you've loaded them online at least once." color={C.amber} />
      ) : isError ? (
        <ErrorState onRetry={refetch} message={listErrorMsg} />
      ) : (
        <FlatList
          data={inspections}
          renderItem={renderHistoryItem}
          keyExtractor={(item) => String(item.id ?? item.timestamp)}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={C.green} />}
          contentContainerStyle={inspections.length === 0 ? styles.emptyContainer : styles.listPad}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <EmptyState icon="fact-check" title="No inspections yet" subtitle="Tap + to log your first property inspection." color={C.green} />
          }
        />
      )}

      {/* Form sheet */}
      {showForm && (
        <View style={styles.formSheet}>
          <View style={styles.formHandle} />
          <View style={styles.formHeader}>
            <TouchableOpacity onPress={() => { setShowForm(false); setFieldErrors({}); }}>
              <Icon name="close" size={24} color={C.textSub} />
            </TouchableOpacity>
            <Text style={styles.formTitle}>New Inspection</Text>
            <TouchableOpacity onPress={handleSubmit} disabled={createMutation.isPending} style={styles.saveBtn}>
              {createMutation.isPending
                ? <ActivityIndicator color="white" size="small" />
                : <Text style={styles.saveBtnText}>Save</Text>
              }
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.formBody} keyboardShouldPersistTaps="handled">
            {/* Property */}
            <Text style={styles.fieldLabel}>Property <Text style={{ color: C.red }}>*</Text></Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
              {properties.length === 0 ? (
                <TextInput
                  style={styles.input}
                  value={form.propertyId}
                  onChangeText={(v) => { setForm((f) => ({ ...f, propertyId: v })); setFieldErrors((e) => ({ ...e, propertyId: '' })); }}
                  placeholder="Enter property ID"
                  keyboardType="numeric"
                  placeholderTextColor={C.textMuted}
                />
              ) : (
                (properties as any[]).map((p: any) => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.chip, form.propertyId === String(p.id) && styles.chipActive]}
                    onPress={() => { setForm((f) => ({ ...f, propertyId: String(p.id) })); setFieldErrors((e) => ({ ...e, propertyId: '' })); }}
                  >
                    <Text style={[styles.chipText, form.propertyId === String(p.id) && styles.chipTextActive]}>{p.name}</Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
            {fieldErrors.propertyId ? <Text style={styles.fieldError}>{fieldErrors.propertyId}</Text> : null}

            {/* Type */}
            <Text style={styles.fieldLabel}>Inspection Type</Text>
            <View style={styles.typeGrid}>
              {INSPECTION_TYPES.map((t) => (
                <TouchableOpacity
                  key={t.value}
                  style={[styles.typeCard, form.inspectionType === t.value && styles.typeCardActive]}
                  onPress={() => setForm((f) => ({ ...f, inspectionType: t.value }))}
                >
                  <Icon name={t.icon} size={22} color={form.inspectionType === t.value ? C.green : C.textSub} />
                  <Text style={[styles.typeText, form.inspectionType === t.value && styles.typeTextActive]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Condition */}
            <Text style={styles.fieldLabel}>Overall Condition</Text>
            <View style={styles.condRow}>
              {CONDITION_OPTIONS.map((c) => (
                <TouchableOpacity
                  key={c.value}
                  style={[styles.condBtn, { borderColor: c.color }, form.condition === c.value && { backgroundColor: `${c.color}18` }]}
                  onPress={() => setForm((f) => ({ ...f, condition: c.value }))}
                >
                  <View style={[styles.condDot2, { backgroundColor: c.color }]} />
                  <Text style={[styles.condText, form.condition === c.value && { color: c.color, fontWeight: '700' }]}>{c.label}</Text>
                  {form.condition === c.value && <Icon name="check" size={14} color={c.color} style={{ marginLeft: 'auto' as any }} />}
                </TouchableOpacity>
              ))}
            </View>

            {/* Notes */}
            <Text style={styles.fieldLabel}>Notes <Text style={{ color: C.red }}>*</Text></Text>
            <View style={[styles.notesWrap, fieldErrors.notes && styles.inputError]}>
              <TextInput
                style={styles.notesInput}
                value={form.notes}
                onChangeText={(v) => { setForm((f) => ({ ...f, notes: v })); setFieldErrors((e) => ({ ...e, notes: '' })); }}
                placeholder="What did you observe? Any issues, safety concerns, or recommendations?"
                placeholderTextColor={C.textMuted}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
              />
            </View>
            {fieldErrors.notes ? <Text style={styles.fieldError}>{fieldErrors.notes}</Text> : null}

            {!isOnline && (
              <View style={styles.offlineNotice}>
                <Icon name="cloud-upload" size={16} color="#3730A3" />
                <Text style={styles.offlineNoticeText}>
                  Offline — this inspection will be saved locally and synced when you reconnect.
                </Text>
              </View>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: C.bg },
  header:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.dark, paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 56 : 20, paddingBottom: 18 },
  title:          { fontSize: 26, fontWeight: '800', color: 'white', letterSpacing: -0.5, marginBottom: 4 },
  addBtn:         { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20, padding: 9 },
  listPad:        { padding: 16 },
  emptyContainer: { flexGrow: 1 },
  histCard:       { backgroundColor: C.surface, borderRadius: R.lg, padding: 14, marginBottom: 10 },
  histRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  histType:       { fontSize: 14, fontWeight: '700', color: C.ink, textTransform: 'capitalize' },
  condBadge:      { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: R.pill },
  condDot:        { width: 6, height: 6, borderRadius: 3 },
  condBadgeText:  { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  histPropRow:    { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  histProp:       { fontSize: 13, color: C.textSub, flex: 1 },
  histNotes:      { fontSize: 13, color: C.text, lineHeight: 18, marginBottom: 6 },
  histDate:       { fontSize: 11, color: C.textMuted },
  formSheet:      { position: 'absolute', bottom: 0, left: 0, right: 0, top: 80, backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, elevation: 16, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 12 },
  formHandle:     { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  formHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  formTitle:      { fontSize: 18, fontWeight: '700', color: C.ink },
  saveBtn:        { backgroundColor: C.green, paddingHorizontal: 16, paddingVertical: 6, borderRadius: R.pill, minWidth: 64, alignItems: 'center', minHeight: 32, justifyContent: 'center' },
  saveBtnText:    { fontSize: 14, fontWeight: '700', color: 'white' },
  formBody:       { flex: 1, padding: 16 },
  fieldLabel:     { fontSize: 12, fontWeight: '700', color: C.textSub, marginBottom: 8, marginTop: 18, textTransform: 'uppercase', letterSpacing: 0.4 },
  fieldError:     { fontSize: 12, color: C.red, marginTop: 5 },
  input:          { borderWidth: 1.5, borderColor: C.border, borderRadius: R.md, padding: 12, fontSize: 15, backgroundColor: C.bg, color: C.ink },
  inputError:     { borderColor: C.red },
  chipRow:        { flexGrow: 0, marginBottom: 4 },
  chip:           { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, marginRight: 8, backgroundColor: C.bg },
  chipActive:     { borderColor: C.green, backgroundColor: C.greenLight },
  chipText:       { fontSize: 13, color: C.textSub },
  chipTextActive: { color: C.greenDark, fontWeight: '700' },
  typeGrid:       { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  typeCard:       { width: '47%', alignItems: 'center', padding: 12, borderWidth: 1.5, borderColor: C.border, borderRadius: R.md, backgroundColor: C.bg },
  typeCardActive: { borderColor: C.green, backgroundColor: C.greenLight },
  typeText:       { fontSize: 12, color: C.textSub, marginTop: 6 },
  typeTextActive: { color: C.greenDark, fontWeight: '700' },
  condRow:        { gap: 8 },
  condBtn:        { flexDirection: 'row', alignItems: 'center', padding: 12, borderWidth: 1.5, borderRadius: R.md, backgroundColor: C.bg },
  condDot2:       { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  condText:       { fontSize: 15, color: C.text },
  notesWrap:      { borderWidth: 1.5, borderColor: C.border, borderRadius: R.md, backgroundColor: C.bg },
  notesInput:     { padding: 12, fontSize: 15, color: C.ink, minHeight: 110 },
  offlineNotice:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: C.indigoLight, padding: 12, borderRadius: R.md, marginTop: 20, borderWidth: 1, borderColor: '#C7D2FE' },
  offlineNoticeText: { fontSize: 13, color: '#3730A3', flex: 1, lineHeight: 18 },
});

export default InspectionsScreen;
