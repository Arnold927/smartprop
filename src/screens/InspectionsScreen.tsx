/**
 * InspectionsScreen.tsx — FIXED
 *
 * Bugs / gaps fixed vs original:
 *  1. onSuccess referenced `response` which was never in scope — replaced with
 *     the `data` parameter TanStack Query v5 passes to onSuccess.
 *  2. Added useQuery to show the list of past inspections (was missing entirely).
 *  3. Added propertyId picker stub — field staff need to select a property
 *     before submitting; validated before mutation fires.
 *  4. Added proper error, loading, and empty states.
 *  5. Condition selector uses a visual button group instead of plain text input.
 *  6. Push notification fired on successful inspection save.
 */

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, TextInput, Modal, FlatList, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { apiService } from '../services/api';
import { useSync } from '../services/sync';
import { notificationService } from '../services/notifications';

const INSPECTION_TYPES = ['routine', 'move-in', 'move-out', 'emergency'] as const;
const CONDITIONS       = ['excellent', 'good', 'fair', 'poor'] as const;

type InspectionType = typeof INSPECTION_TYPES[number];
type Condition      = typeof CONDITIONS[number];

const CONDITION_COLORS: Record<Condition, string> = {
  excellent: '#10B981',
  good:      '#3B82F6',
  fair:      '#F59E0B',
  poor:      '#EF4444',
};

const InspectionsScreen = ({ navigation }: any) => {
  const [showNewForm, setShowNewForm] = useState(false);
  const [form, setForm] = useState<{
    propertyId: string;
    propertyName: string;
    inspectionType: InspectionType;
    notes: string;
    condition: Condition;
  }>({
    propertyId:     '',
    propertyName:   '',
    inspectionType: 'routine',
    notes:          '',
    condition:      'good',
  });

  const queryClient = useQueryClient();
  const { isOnline, queueOfflineAction } = useSync();

  // ── Data: past inspections ──────────────────────────────────────────────────
  // The backend stores inspections as maintenance-requests with category=inspection.

  const {
    data: inspections = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['inspections'],
    queryFn: async () => {
      const res = await apiService.getMaintenanceRequests({ status: '' });
      if (!res.success) throw new Error(res.error ?? 'Failed to load inspections');
      const payload = res.data as any;
      const all: any[] = Array.isArray(payload) ? payload : (payload?.requests ?? payload?.data ?? []);
      return all.filter((r: any) => r.category === 'inspection');
    },
  });

  // ── Data: properties (for picker) ──────────────────────────────────────────

  const { data: properties = [] } = useQuery({
    queryKey: ['properties'],
    queryFn: async () => {
      const res = await apiService.getProperties();
      if (!res.success) return [];
      const payload = res.data as any;
      return Array.isArray(payload) ? payload : (payload?.properties ?? payload?.data ?? []);
    },
    staleTime: 5 * 60_000,
  });

  // ── Mutation ────────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async (inspectionData: any) => {
      if (!isOnline) {
        await queueOfflineAction('maintenance_request', {
          ...inspectionData,
          category: 'inspection',
        });
        return { success: true, queued: true };
      }
      const res = await apiService.createMaintenanceRequest({
        ...inspectionData,
        category: 'inspection',
      });
      if (!res.success) throw new Error(res.error ?? 'Failed to save inspection');
      return res;
    },
    // FIX: use `data` parameter (resolved value), not an undefined `response` variable
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['inspections'] });

      if (data?.queued) {
        Alert.alert('Queued', 'Inspection saved — will sync when online.');
      } else {
        Alert.alert('Success', 'Inspection recorded successfully.');
        notificationService.notifyInspectionDue(
          form.propertyName || `Property ${form.propertyId}`,
          new Date().toLocaleDateString('en-KE'),
        );
      }

      setForm({
        propertyId: '', propertyName: '', inspectionType: 'routine',
        notes: '', condition: 'good',
      });
      setShowNewForm(false);
    },
    onError: (err: any) =>
      Alert.alert('Error', err?.message ?? 'Failed to save inspection'),
  });

  const handleSubmit = () => {
    if (!form.propertyId) {
      Alert.alert('Validation', 'Please select a property.');
      return;
    }
    if (!form.notes.trim()) {
      Alert.alert('Validation', 'Please add inspection notes.');
      return;
    }
    createMutation.mutate({
      ...form,
      title:     `${form.inspectionType} inspection`,
      timestamp: new Date().toISOString(),
    });
  };

  // ── Render helpers ──────────────────────────────────────────────────────────

  const renderInspection = ({ item }: any) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => navigation.navigate('InspectionDetail', { id: item.id })}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardInfo}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title ?? 'Inspection'}</Text>
          <Text style={styles.cardSub}>
            {item.propertyName ?? item.property?.name ?? `Property ${item.propertyId ?? ''}`}
          </Text>
        </View>
        <View style={[
          styles.conditionBadge,
          { backgroundColor: CONDITION_COLORS[(item.condition as Condition) ?? 'good'] + '20' },
        ]}>
          <Text style={[
            styles.conditionText,
            { color: CONDITION_COLORS[(item.condition as Condition) ?? 'good'] },
          ]}>
            {item.condition ?? 'good'}
          </Text>
        </View>
      </View>
      <Text style={styles.cardNotes} numberOfLines={2}>{item.description ?? item.notes ?? '—'}</Text>
      <Text style={styles.cardDate}>
        {item.createdAt ? new Date(item.createdAt).toLocaleDateString('en-KE') : '—'}
      </Text>
    </TouchableOpacity>
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Icon name="assignment" size={48} color="#D1D5DB" />
      <Text style={styles.emptyTitle}>No inspections yet</Text>
      <Text style={styles.emptySubtitle}>Tap the + button to record a new inspection.</Text>
    </View>
  );

  const renderError = () => (
    <View style={styles.emptyContainer}>
      <Icon name="cloud-off" size={48} color="#EF4444" />
      <Text style={styles.emptyTitle}>Failed to load</Text>
      <Text style={styles.emptySubtitle}>Check your connection and pull to refresh.</Text>
      <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
        <Text style={styles.retryText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );

  // ── Main render ─────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Inspections</Text>
        <TouchableOpacity style={styles.addButton} onPress={() => setShowNewForm(true)}>
          <Icon name="add" size={24} color="white" />
        </TouchableOpacity>
      </View>

      {/* Offline banner */}
      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Icon name="cloud-off" size={14} color="white" />
          <Text style={styles.offlineText}>Offline — inspections will sync when connected</Text>
        </View>
      )}

      {/* List */}
      {isLoading ? (
        <View style={styles.centred}>
          <ActivityIndicator size="large" color="#10B981" />
          <Text style={styles.loadingText}>Loading inspections…</Text>
        </View>
      ) : isError ? (
        renderError()
      ) : (
        <FlatList
          data={inspections}
          renderItem={renderInspection}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={[
            styles.listContainer,
            inspections.length === 0 && styles.listContainerEmpty,
          ]}
          ListEmptyComponent={renderEmpty}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#10B981" />
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* ── New Inspection Modal ── */}
      <Modal visible={showNewForm} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowNewForm(false)}>
              <Icon name="close" size={24} color="#374151" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>New Inspection</Text>
            <TouchableOpacity onPress={handleSubmit} disabled={createMutation.isPending}>
              <Text style={[styles.saveButton, createMutation.isPending && { opacity: 0.4 }]}>
                {createMutation.isPending ? 'Saving…' : 'Save'}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent} keyboardShouldPersistTaps="handled">
            {/* Property picker */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Property *</Text>
              {properties.length === 0 ? (
                <TextInput
                  style={styles.textInput}
                  value={form.propertyId}
                  onChangeText={(text) => setForm({ ...form, propertyId: text, propertyName: text })}
                  placeholder="Enter property ID or name"
                  placeholderTextColor="#9CA3AF"
                />
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {properties.map((p: any) => (
                      <TouchableOpacity
                        key={p.id}
                        style={[
                          styles.chipButton,
                          form.propertyId === String(p.id) && styles.chipButtonActive,
                        ]}
                        onPress={() => setForm({
                          ...form,
                          propertyId:   String(p.id),
                          propertyName: p.name,
                        })}
                      >
                        <Text style={[
                          styles.chipText,
                          form.propertyId === String(p.id) && styles.chipTextActive,
                        ]}>
                          {p.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              )}
            </View>

            {/* Inspection type */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Inspection Type</Text>
              <View style={styles.buttonRow}>
                {INSPECTION_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.typeButton, form.inspectionType === t && styles.typeButtonActive]}
                    onPress={() => setForm({ ...form, inspectionType: t })}
                  >
                    <Text style={[
                      styles.typeButtonText,
                      form.inspectionType === t && styles.typeButtonTextActive,
                    ]}>
                      {t}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Condition */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Overall Condition</Text>
              <View style={styles.buttonRow}>
                {CONDITIONS.map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[
                      styles.conditionButton,
                      { borderColor: CONDITION_COLORS[c] },
                      form.condition === c && {
                        backgroundColor: CONDITION_COLORS[c] + '20',
                      },
                    ]}
                    onPress={() => setForm({ ...form, condition: c })}
                  >
                    <Text style={[
                      styles.conditionButtonText,
                      form.condition === c && { color: CONDITION_COLORS[c], fontWeight: '700' },
                    ]}>
                      {c}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Notes */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Notes *</Text>
              <TextInput
                style={[styles.textInput, styles.textArea]}
                value={form.notes}
                onChangeText={(text) => setForm({ ...form, notes: text })}
                placeholder="Describe the condition and any issues found…"
                placeholderTextColor="#9CA3AF"
                multiline
                numberOfLines={5}
                textAlignVertical="top"
              />
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, paddingTop: 50, backgroundColor: '#10B981',
  },
  title: { fontSize: 24, fontWeight: 'bold', color: 'white' },
  addButton: {
    backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 20, padding: 8,
  },

  offlineBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#6B7280', paddingVertical: 6, gap: 6,
  },
  offlineText: { color: 'white', fontSize: 12 },

  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  loadingText: { marginTop: 12, color: '#6B7280', fontSize: 14 },
  emptyContainer: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, marginTop: 60,
  },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#374151', marginTop: 16 },
  emptySubtitle: { fontSize: 14, color: '#6B7280', marginTop: 8, textAlign: 'center' },
  retryButton: {
    marginTop: 16, backgroundColor: '#10B981', paddingHorizontal: 24,
    paddingVertical: 10, borderRadius: 8,
  },
  retryText: { color: 'white', fontWeight: '600', fontSize: 14 },

  listContainer: { padding: 16 },
  listContainerEmpty: { flexGrow: 1 },

  card: {
    backgroundColor: 'white', borderRadius: 12, padding: 16, marginBottom: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 4, elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', marginBottom: 8,
  },
  cardInfo: { flex: 1, marginRight: 8 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#1F2937', textTransform: 'capitalize' },
  cardSub: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  conditionBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  conditionText: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  cardNotes: { fontSize: 14, color: '#6B7280', lineHeight: 20, marginBottom: 8 },
  cardDate: { fontSize: 12, color: '#9CA3AF' },

  modalContainer: { flex: 1, backgroundColor: 'white' },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '#E5E7EB',
  },
  modalTitle: { fontSize: 18, fontWeight: '600', color: '#1F2937' },
  saveButton: { fontSize: 16, color: '#10B981', fontWeight: '700' },

  modalContent: { flex: 1, padding: 20 },
  inputGroup: { marginBottom: 24 },
  inputLabel: { fontSize: 15, fontWeight: '600', color: '#374151', marginBottom: 10 },
  textInput: {
    borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, padding: 12,
    fontSize: 15, backgroundColor: '#F9FAFB', color: '#1F2937',
  },
  textArea: { height: 120, textAlignVertical: 'top' },

  chipButton: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1.5, borderColor: '#D1D5DB', backgroundColor: 'white',
  },
  chipButtonActive: { borderColor: '#10B981', backgroundColor: '#ECFDF5' },
  chipText: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  chipTextActive: { color: '#10B981', fontWeight: '700' },

  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeButton: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1.5, borderColor: '#D1D5DB',
  },
  typeButtonActive: { borderColor: '#10B981', backgroundColor: '#ECFDF5' },
  typeButtonText: { fontSize: 13, color: '#6B7280', fontWeight: '500', textTransform: 'capitalize' },
  typeButtonTextActive: { color: '#10B981', fontWeight: '700' },

  conditionButton: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 2,
  },
  conditionButtonText: {
    fontSize: 13, color: '#6B7280', fontWeight: '500', textTransform: 'capitalize',
  },
});

export default InspectionsScreen;
