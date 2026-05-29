import { Request } from 'express';
import { sql, and, or, eq, like, desc, asc } from 'drizzle-orm';

export interface QueryOptions {
  filters?: Record<string, any>;
  search?: { fields: string[]; query: string };
  ordering?: string[];
  page?: number;
  pageSize?: number;
}

export const parseQueryOptions = (req: Request): QueryOptions => {
  const options: QueryOptions = {
    page: req.query.page ? parseInt(req.query.page as string) : 1,
    pageSize: req.query.page_size ? parseInt(req.query.page_size as string) : 20,
  };

  if (req.query.ordering) {
    options.ordering = (req.query.ordering as string).split(',');
  }

  if (req.query.search) {
    // This is a simplified search, in a real app you'd define searchable fields per model
    options.search = {
      fields: (req.query.search_fields as string || 'name').split(','),
      query: req.query.search as string
    };
  }

  // Extract other query params as filters, excluding known ones
  const reserved = ['page', 'page_size', 'ordering', 'search', 'search_fields'];
  const filters: Record<string, any> = {};
  
  Object.keys(req.query).forEach(key => {
    // Skip reserved keywords and empty keys
    if (!reserved.includes(key) && key && key.trim() !== '') {
      const value = req.query[key];
      // Only add filter if value is not undefined, null, or empty string
      if (value !== undefined && value !== null && value !== '') {
        filters[key] = value;
      }
    }
  });
  
  if (Object.keys(filters).length > 0) {
    options.filters = filters;
  }

  return options;
};

export const buildQuery = (baseQuery: any, table: any, options: QueryOptions) => {
  let query = baseQuery;
  const conditions: any[] = [];

  // Apply filters - with validation
  if (options.filters) {
    Object.entries(options.filters).forEach(([key, value]) => {
      // Skip empty keys or undefined/null values
      if (!key || key.trim() === '' || value === undefined || value === null || value === '') {
        return;
      }
      
      // Check if the column exists in the table
      if (table && table[key]) {
        conditions.push(eq(table[key], value));
      } else {
        console.warn(`Warning: Filter column "${key}" not found in table, skipping`);
      }
    });
  }

  // Apply search
  if (options.search && options.search.fields.length > 0 && options.search.query) {
    const searchConditions = options.search.fields
      .filter(field => field && field.trim() !== '' && table && table[field])
      .map(field => like(table[field], `%${options.search!.query}%`));
    
    if (searchConditions.length > 0) {
      conditions.push(or(...searchConditions));
    }
  }

  // Only add WHERE clause if there are conditions
  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  // Apply ordering
  if (options.ordering && options.ordering.length > 0) {
    const orderBy = options.ordering
      .map(field => {
        if (!field) return null;
        const isDesc = field.startsWith('-');
        const fieldName = isDesc ? field.substring(1) : field;
        
        // Check if field exists in table
        if (table && table[fieldName]) {
          return isDesc ? desc(table[fieldName]) : asc(table[fieldName]);
        }
        return null;
      })
      .filter(Boolean);
    
    if (orderBy.length > 0) {
      query = query.orderBy(...orderBy);
    }
  } else if (table && table.createdAt) {
    // Default ordering by created_at if no ordering specified
    query = query.orderBy(desc(table.createdAt));
  } else if (table && table.id) {
    query = query.orderBy(desc(table.id));
  }

  // Apply pagination
  const page = options.page || 1;
  const pageSize = options.pageSize || 20;
  query = query.limit(pageSize).offset((page - 1) * pageSize);

  return query;
};

export const paginateResponse = <T>(
  results: T[],
  total: number,
  page: number,
  pageSize: number,
  baseUrl: string
) => {
  const totalPages = Math.ceil(total / pageSize);
  return {
    count: total,
    next: page < totalPages ? `${baseUrl}?page=${page + 1}&page_size=${pageSize}` : null,
    previous: page > 1 ? `${baseUrl}?page=${page - 1}&page_size=${pageSize}` : null,
    results
  };
};
