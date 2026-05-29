import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, TextInput, Animated,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { apiService } from '../services/api';

const TenantsScreen = ({ navigation }: any) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch]   = useState(false);

  const { data: tenants = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['tenants'],
    queryFn: async () => {
      const response = await apiService.getTenants();
      return Array.isArray(response.data) ? response.data : [];
    },
  });

  const renderTenant = ({ item }: any) => (
    <TouchableOpacity
      style={styles.tenantCard}
      onPress={() => navigation.navigate('TenantDetail', { tenantId: item.id })}
    >
      <View style={styles.tenantHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {item.firstName?.[0]}{item.lastName?.[0]}
          </Text>
        </View>
        <View style={styles.tenantInfo}>
          <Text style={styles.tenantName}>
            {item.firstName} {item.lastName}
          </Text>
          <Text style={styles.tenantUnit}>Unit {item.unitNumber || 'N/A'}</Text>
          <Text style={styles.tenantContact}>{item.email}</Text>
        </View>
        <View style={styles.statusContainer}>
          <View style={[
            styles.statusBadge, 
            { backgroundColor: item.leaseStatus === 'active' ? '#10B981' : '#6B7280' }
          ]}>
            <Text style={styles.statusText}>{item.leaseStatus || 'Active'}</Text>
          </View>
        </View>
      </View>

      <View style={styles.tenantStats}>
        <View style={styles.stat}>
          <Icon name="payments" size={16} color="#3B82F6" />
          <Text style={styles.statLabel}>Rent</Text>
          <Text style={styles.statValue}>KES {item.monthlyRent || 0}</Text>
        </View>
        <View style={styles.stat}>
          <Icon name="date-range" size={16} color="#10B981" />
          <Text style={styles.statLabel}>Lease End</Text>
          <Text style={styles.statValue}>
            {item.leaseEndDate ? new Date(item.leaseEndDate).toLocaleDateString() : 'N/A'}
          </Text>
        </View>
        <View style={styles.stat}>
          <Icon name="build" size={16} color="#F59E0B" />
          <Text style={styles.statLabel}>Requests</Text>
          <Text style={styles.statValue}>{item.maintenanceRequests || 0}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Tenants</Text>
        <TouchableOpacity style={styles.searchButton} onPress={() => setShowSearch(s => !s)}>
          <Icon name={showSearch ? 'close' : 'search'} size={24} color="white" />
        </TouchableOpacity>
      </View>

      {showSearch && (
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search by name, email or unit…"
          autoFocus
          clearButtonMode="while-editing"
        />
      )}
      <FlatList
        data={useMemo(() => {
          const q = searchQuery.toLowerCase();
          if (!q) return tenants;
          return tenants.filter((t: any) =>
            `${t.firstName} ${t.lastName}`.toLowerCase().includes(q) ||
            (t.email ?? '').toLowerCase().includes(q) ||
            (t.unitNumber ?? '').toLowerCase().includes(q)
          );
        }, [tenants, searchQuery])}
        renderItem={renderTenant}
        keyExtractor={(item) => item.id.toString()}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refetch} />
        }
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 50,
    backgroundColor: '#10B981',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  searchButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
    padding: 8,
  },
  listContainer: {
    padding: 16,
  },
  tenantCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  tenantHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  tenantInfo: {
    flex: 1,
    marginLeft: 12,
  },
  tenantName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
  },
  tenantUnit: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 2,
  },
  tenantContact: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  statusContainer: {
    alignItems: 'flex-end',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    color: 'white',
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  tenantStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: 16,
  },
  stat: {
    alignItems: 'center',
    flex: 1,
  },
  statLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
    marginTop: 2,
  },
  searchInput: {
    margin: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'white',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    fontSize: 15,
  },
});

export default TenantsScreen;