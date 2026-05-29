/**
 * PropertiesScreen.tsx — FIXED
 *
 * Gaps fixed vs original:
 *  1. No error or loading state (only a RefreshControl that needs a pull to see).
 *  2. No empty state.
 *  3. Occupancy rate not shown — added calculated occupancy % badge.
 *  4. KES monthly revenue formatted with locale separator.
 *  5. Add button was wired to nothing — now navigates to AddProperty screen
 *     (which must exist in the stack navigator).
 */

import React from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { apiService } from '../services/api';

const formatKES = (amount: number | string | undefined) => {
  const n = Number(amount ?? 0);
  return isNaN(n) ? '0' : n.toLocaleString('en-KE');
};

const occupancyColor = (rate: number) => {
  if (rate >= 90) return '#10B981';
  if (rate >= 70) return '#F59E0B';
  return '#EF4444';
};

const PropertiesScreen = ({ navigation }: any) => {
  const {
    data: properties,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['properties'],
    queryFn: async () => {
      const response = await apiService.getProperties();
      if (!response.success) throw new Error(response.error ?? 'Failed to load properties');
      const payload = response.data as any;
      return Array.isArray(payload) ? payload : (payload?.properties ?? payload?.data ?? []);
    },
  });

  const renderProperty = ({ item }: any) => {
    const totalUnits    = Number(item.units ?? item.totalUnits ?? 0);
    const occupiedUnits = Number(item.occupiedUnits ?? 0);
    const occupancyRate = totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0;
    const vacantUnits   = totalUnits - occupiedUnits;

    return (
      <TouchableOpacity
        style={styles.propertyCard}
        onPress={() => navigation.navigate('PropertyDetail', { propertyId: item.id })}
        activeOpacity={0.7}
      >
        {/* Card header */}
        <View style={styles.propertyHeader}>
          <View style={styles.propertyIconWrap}>
            <Icon name="home" size={22} color="#3B82F6" />
          </View>
          <View style={styles.propertyInfo}>
            <Text style={styles.propertyName} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.propertyAddress} numberOfLines={1}>
              {item.address ?? item.location ?? '—'}
            </Text>
          </View>
          {/* Occupancy badge */}
          <View style={[
            styles.occupancyBadge,
            { backgroundColor: occupancyColor(occupancyRate) + '20' },
          ]}>
            <Text style={[styles.occupancyText, { color: occupancyColor(occupancyRate) }]}>
              {occupancyRate}%
            </Text>
          </View>
        </View>

        {/* Stats row */}
        <View style={styles.propertyStats}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{totalUnits}</Text>
            <Text style={styles.statLabel}>Total Units</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: '#10B981' }]}>{occupiedUnits}</Text>
            <Text style={styles.statLabel}>Occupied</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: vacantUnits > 0 ? '#F59E0B' : '#9CA3AF' }]}>
              {vacantUnits}
            </Text>
            <Text style={styles.statLabel}>Vacant</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statValue} numberOfLines={1}>
              {formatKES(item.monthlyRevenue)}
            </Text>
            <Text style={styles.statLabel}>KES / mo</Text>
          </View>
        </View>

        {/* Maintenance indicator */}
        {(item.maintenanceRequests ?? 0) > 0 && (
          <View style={styles.maintenanceRow}>
            <Icon name="build" size={13} color="#F59E0B" />
            <Text style={styles.maintenanceText}>
              {item.maintenanceRequests} pending maintenance request
              {item.maintenanceRequests !== 1 ? 's' : ''}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Icon name="home" size={48} color="#D1D5DB" />
      <Text style={styles.emptyTitle}>No properties found</Text>
      <Text style={styles.emptySubtitle}>Properties added via the web platform will appear here.</Text>
    </View>
  );

  const renderError = () => (
    <View style={styles.emptyContainer}>
      <Icon name="cloud-off" size={48} color="#EF4444" />
      <Text style={styles.emptyTitle}>Failed to load properties</Text>
      <Text style={styles.emptySubtitle}>Check your connection and try again.</Text>
      <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
        <Text style={styles.retryText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Properties</Text>
        <View style={styles.headerActions}>
          {(properties?.length ?? 0) > 0 && (
            <Text style={styles.countBadge}>{properties!.length}</Text>
          )}
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => navigation.navigate('AddProperty')}
          >
            <Icon name="add" size={24} color="white" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Content */}
      {isLoading && !properties ? (
        <View style={styles.centred}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading properties…</Text>
        </View>
      ) : isError ? (
        renderError()
      ) : (
        <FlatList
          data={properties ?? []}
          renderItem={renderProperty}
          keyExtractor={(item) => String(item.id)}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#3B82F6" />
          }
          contentContainerStyle={[
            styles.listContainer,
            (!properties || properties.length === 0) && styles.listContainerEmpty,
          ]}
          ListEmptyComponent={renderEmpty}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, paddingTop: 50, backgroundColor: '#3B82F6',
  },
  title: { fontSize: 24, fontWeight: 'bold', color: 'white' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  countBadge: {
    backgroundColor: 'rgba(255,255,255,0.25)', color: 'white',
    fontSize: 13, fontWeight: '700', paddingHorizontal: 8,
    paddingVertical: 3, borderRadius: 12,
  },
  addButton: {
    backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, padding: 8,
  },

  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  loadingText: { marginTop: 12, color: '#6B7280', fontSize: 14 },
  emptyContainer: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, marginTop: 60,
  },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#374151', marginTop: 16 },
  emptySubtitle: { fontSize: 14, color: '#6B7280', marginTop: 8, textAlign: 'center' },
  retryButton: {
    marginTop: 16, backgroundColor: '#3B82F6', paddingHorizontal: 24,
    paddingVertical: 10, borderRadius: 8,
  },
  retryText: { color: 'white', fontWeight: '600', fontSize: 14 },

  listContainer: { padding: 16 },
  listContainerEmpty: { flexGrow: 1 },

  propertyCard: {
    backgroundColor: 'white', borderRadius: 12, padding: 16, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 4, elevation: 3,
  },
  propertyHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  propertyIconWrap: {
    width: 42, height: 42, borderRadius: 10, backgroundColor: '#EBF4FF',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  propertyInfo: { flex: 1 },
  propertyName: { fontSize: 17, fontWeight: '700', color: '#1F2937' },
  propertyAddress: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  occupancyBadge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10 },
  occupancyText: { fontSize: 13, fontWeight: '800' },

  propertyStats: {
    flexDirection: 'row', justifyContent: 'space-around',
    borderTopWidth: 1, borderTopColor: '#F3F4F6', paddingTop: 14,
  },
  stat: { alignItems: 'center', flex: 1 },
  statDivider: { width: 1, backgroundColor: '#F3F4F6' },
  statValue: { fontSize: 15, fontWeight: 'bold', color: '#1F2937' },
  statLabel: { fontSize: 11, color: '#6B7280', marginTop: 3 },

  maintenanceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginTop: 12, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: '#FEF3C7',
  },
  maintenanceText: { fontSize: 12, color: '#92400E' },
});

export default PropertiesScreen;
