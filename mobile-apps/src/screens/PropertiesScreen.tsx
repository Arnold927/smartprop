import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { apiService, ApiResponse } from '../services/api';

// Define the PropertyListItem interface
interface PropertyListItem {
  id: number;
  name: string;
  address: string;
  totalUnits: number;
  occupiedUnits?: number;
  monthlyRevenue?: number;
  maintenanceRequests?: number;
}

const PropertiesScreen = ({ navigation }: any) => {
  const { data: properties, isLoading, refetch } = useQuery<PropertyListItem[]>({
    queryKey: ['properties'],
    queryFn: async () => {
      const response = await apiService.getProperties();
      return (response.data || []) as PropertyListItem[];
    },
  });

  const renderProperty = ({ item }: { item: PropertyListItem }) => (
    <TouchableOpacity
      style={styles.propertyCard}
      onPress={() => navigation.navigate('PropertyDetail', { propertyId: item.id })}
    >
      <View style={styles.propertyHeader}>
        <Icon name="home" size={24} color="#3B82F6" />
        <View style={styles.propertyInfo}>
          <Text style={styles.propertyName}>{item.name}</Text>
          <Text style={styles.propertyAddress}>{item.address}</Text>
        </View>
        <View style={styles.propertyBadge}>
          <Text style={styles.propertyBadgeText}>{item.totalUnits || 0} units</Text>
        </View>
      </View>
      
      <View style={styles.propertyStats}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{item.occupiedUnits || 0}</Text>
          <Text style={styles.statLabel}>Occupied</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>KES {item.monthlyRevenue || 0}</Text>
          <Text style={styles.statLabel}>Monthly Revenue</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{item.maintenanceRequests || 0}</Text>
          <Text style={styles.statLabel}>Maintenance</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Properties</Text>
        <TouchableOpacity style={styles.addButton}>
          <Icon name="add" size={24} color="white" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={properties || []}
        renderItem={renderProperty}
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
    backgroundColor: '#3B82F6',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  addButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
    padding: 8,
  },
  listContainer: {
    padding: 16,
  },
  propertyCard: {
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
  propertyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  propertyInfo: {
    flex: 1,
    marginLeft: 12,
  },
  propertyName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1F2937',
  },
  propertyAddress: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 2,
  },
  propertyBadge: {
    backgroundColor: '#EBF4FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  propertyBadgeText: {
    fontSize: 12,
    color: '#3B82F6',
    fontWeight: '600',
  },
  propertyStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: 16,
  },
  stat: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  statLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
});

export default PropertiesScreen;
