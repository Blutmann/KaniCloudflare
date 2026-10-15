export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      barbers: {
        Row: {
          id: string
          name: string
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      services: {
        Row: {
          id: string
          name: string
          duration_minutes: number
          price_ars: number
          active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          duration_minutes: number
          price_ars: number
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          duration_minutes?: number
          price_ars?: number
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      barber_transfer_details: {
        Row: {
          barber_id: string
          alias: string
          cuit: string
          holder_name: string
          down_payment_ars: number
          active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          barber_id: string
          alias: string
          cuit: string
          holder_name: string
          down_payment_ars?: number
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          barber_id?: string
          alias?: string
          cuit?: string
          holder_name?: string
          down_payment_ars?: number
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      clients: {
        Row: {
          id: string
          name: string
          phone: string
          email: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          phone: string
          email: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          phone?: string
          email?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      appointments: {
        Row: {
          id: string
          request_number: number
          client_id: string
          barber_id: string
          service_id: string
          booking_date: string
          start_time: string
          end_time: string
          status: "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED"
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          request_number?: number
          client_id: string
          barber_id: string
          service_id: string
          booking_date: string
          start_time: string
          end_time: string
          status?: "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED"
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          request_number?: number
          client_id?: string
          barber_id?: string
          service_id?: string
          booking_date?: string
          start_time?: string
          end_time?: string
          status?: "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED"
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      barber_availability_slots: {
        Row: {
          id: string
          barber_id: string
          slot_date: string
          start_time: string
          end_time: string
          status: "AVAILABLE" | "UNAVAILABLE"
          internal_note: string | null
          created_at: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          barber_id: string
          slot_date: string
          start_time: string
          end_time: string
          status?: "AVAILABLE" | "UNAVAILABLE"
          internal_note?: string | null
          created_at?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          barber_id?: string
          slot_date?: string
          start_time?: string
          end_time?: string
          status?: "AVAILABLE" | "UNAVAILABLE"
          internal_note?: string | null
          created_at?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      admin_activity_notifications: {
        Row: {
          id: string
          event_type: "AVAILABILITY_UNAVAILABLE" | "AVAILABILITY_AVAILABLE" | "APPOINTMENT_REQUESTED" | "APPOINTMENT_CONFIRMED" | "APPOINTMENT_CANCELLED"
          actor_user_id: string | null
          actor_display_name: string
          barber_id: string | null
          appointment_id: string | null
          availability_slot_id: string | null
          barber_name: string
          client_name: string | null
          event_date: string
          event_time: string | null
          created_at: string
          read_at: string | null
        }
        Insert: {
          id?: string
          event_type: "AVAILABILITY_UNAVAILABLE" | "AVAILABILITY_AVAILABLE" | "APPOINTMENT_REQUESTED" | "APPOINTMENT_CONFIRMED" | "APPOINTMENT_CANCELLED"
          actor_user_id?: string | null
          actor_display_name: string
          barber_id?: string | null
          appointment_id?: string | null
          availability_slot_id?: string | null
          barber_name: string
          client_name?: string | null
          event_date: string
          event_time?: string | null
          created_at?: string
          read_at?: string | null
        }
        Update: {
          id?: string
          event_type?: "AVAILABILITY_UNAVAILABLE" | "AVAILABILITY_AVAILABLE" | "APPOINTMENT_REQUESTED" | "APPOINTMENT_CONFIRMED" | "APPOINTMENT_CANCELLED"
          actor_user_id?: string | null
          actor_display_name?: string
          barber_id?: string | null
          appointment_id?: string | null
          availability_slot_id?: string | null
          barber_name?: string
          client_name?: string | null
          event_date?: string
          event_time?: string | null
          created_at?: string
          read_at?: string | null
        }
        Relationships: []
      }
      appointment_notification_events: {
        Row: {
          id: string
          appointment_id: string
          notification_type: "NEW_REQUEST" | "CONFIRMED" | "CANCELLED"
          recipient_email: string | null
          client_name: string
          client_notes: string | null
          service_price_ars: number | null
          service_duration_minutes: number | null
          down_payment_ars: number | null
          transfer_alias: string | null
          transfer_cuit: string | null
          transfer_holder_name: string | null
          barber_name: string
          service_name: string
          booking_date: string
          start_time: string
          end_time: string
          claim_token_digest: string
          status: "PENDING" | "SENDING" | "SENT" | "FAILED"
          attempts: number
          provider_message_id: string | null
          last_error: string | null
          sent_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          appointment_id: string
          notification_type: "NEW_REQUEST" | "CONFIRMED" | "CANCELLED"
          recipient_email?: string | null
          client_name: string
          client_notes?: string | null
          service_price_ars?: number | null
          service_duration_minutes?: number | null
          down_payment_ars?: number | null
          transfer_alias?: string | null
          transfer_cuit?: string | null
          transfer_holder_name?: string | null
          barber_name: string
          service_name: string
          booking_date: string
          start_time: string
          end_time: string
          claim_token_digest: string
          status?: "PENDING" | "SENDING" | "SENT" | "FAILED"
          attempts?: number
          provider_message_id?: string | null
          last_error?: string | null
          sent_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          appointment_id?: string
          notification_type?: "NEW_REQUEST" | "CONFIRMED" | "CANCELLED"
          recipient_email?: string | null
          client_name?: string
          client_notes?: string | null
          service_price_ars?: number | null
          service_duration_minutes?: number | null
          down_payment_ars?: number | null
          transfer_alias?: string | null
          transfer_cuit?: string | null
          transfer_holder_name?: string | null
          barber_name?: string
          service_name?: string
          booking_date?: string
          start_time?: string
          end_time?: string
          claim_token_digest?: string
          status?: "PENDING" | "SENDING" | "SENT" | "FAILED"
          attempts?: number
          provider_message_id?: string | null
          last_error?: string | null
          sent_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      maintenance_operations: {
        Row: {
          id: string
          actor_user_id: string | null
          selected_statuses: Array<"PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED">
          status: "RUNNING" | "SUCCEEDED" | "FAILED"
          appointments_deleted: number
          notification_events_deleted: number
          admin_notifications_deleted: number
          error_code: string | null
          started_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          actor_user_id?: string | null
          selected_statuses: Array<"PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED">
          status: "RUNNING" | "SUCCEEDED" | "FAILED"
          appointments_deleted?: number
          notification_events_deleted?: number
          admin_notifications_deleted?: number
          error_code?: string | null
          started_at?: string
          completed_at?: string | null
        }
        Update: {
          id?: string
          actor_user_id?: string | null
          selected_statuses?: Array<"PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED">
          status?: "RUNNING" | "SUCCEEDED" | "FAILED"
          appointments_deleted?: number
          notification_events_deleted?: number
          admin_notifications_deleted?: number
          error_code?: string | null
          started_at?: string
          completed_at?: string | null
        }
        Relationships: []
      }
      maintenance_availability_operations: {
        Row: {
          id: string
          actor_user_id: string | null
          status: "RUNNING" | "SUCCEEDED" | "FAILED"
          notifications_deleted: number
          error_code: string | null
          started_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          actor_user_id?: string | null
          status: "RUNNING" | "SUCCEEDED" | "FAILED"
          notifications_deleted?: number
          error_code?: string | null
          started_at?: string
          completed_at?: string | null
        }
        Update: {
          id?: string
          actor_user_id?: string | null
          status?: "RUNNING" | "SUCCEEDED" | "FAILED"
          notifications_deleted?: number
          error_code?: string | null
          started_at?: string
          completed_at?: string | null
        }
        Relationships: []
      }
      staff_profiles: {
        Row: {
          user_id: string
          role: "BARBER" | "ADMIN"
          barber_id: string | null
          display_name: string
          active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          role: "BARBER" | "ADMIN"
          barber_id?: string | null
          display_name: string
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          role?: "BARBER" | "ADMIN"
          barber_id?: string | null
          display_name?: string
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      available_barber_slots: {
        Row: {
          id: string
          barber_id: string
          slot_date: string
          start_time: string
          end_time: string
          status: "AVAILABLE" | "UNAVAILABLE"
        }
        Relationships: []
      }
    }
    Functions: {
      request_appointment: {
        Args: {
          p_barber_name: string
          p_service_name: string
          p_booking_date: string
          p_start_time: string
          p_client_name: string
          p_client_phone: string
          p_client_email: string
          p_notes?: string | null
        }
        Returns: {
          appointment_id: string
          appointment_status: "PENDING"
          booking_date: string
          start_time: string
          end_time: string
          request_number: number
          notification_claim_token: string | null
        }[]
      }
      update_appointment_status: {
        Args: {
          p_appointment_id: string
          p_status: "CONFIRMED" | "CANCELLED" | "COMPLETED"
        }
        Returns: {
          appointment_status: "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED"
          notification_claim_token: string | null
        }[]
      }
      claim_appointment_notification: {
        Args: {
          p_appointment_id: string
          p_claim_token: string
        }
        Returns: {
          notification_id: string
          notification_type: "NEW_REQUEST" | "CONFIRMED" | "CANCELLED"
          recipient_email: string | null
          client_name: string
          client_notes: string | null
          service_price_ars: number | null
          service_duration_minutes: number | null
          down_payment_ars: number | null
          transfer_alias: string | null
          transfer_cuit: string | null
          transfer_holder_name: string | null
          barber_name: string
          service_name: string
          booking_date: string
          start_time: string
          end_time: string
          dispatch_status: string
          attempt: number
        }[]
      }
      complete_appointment_notification: {
        Args: {
          p_notification_id: string
          p_claim_token: string
          p_provider_message_id: string
        }
        Returns: boolean
      }
      fail_appointment_notification: {
        Args: {
          p_notification_id: string
          p_claim_token: string
          p_error: string
        }
        Returns: boolean
      }
      record_appointment_notification_dispatch_error: {
        Args: {
          p_appointment_id: string
          p_claim_token: string
          p_error: string
        }
        Returns: boolean
      }
      retry_appointment_notification: {
        Args: { p_appointment_id: string }
        Returns: string | null
      }
      admin_cleanup_appointment_records: {
        Args: { p_statuses: Array<"PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED"> }
        Returns: {
          operation_id: string
          operation_status: "RUNNING" | "SUCCEEDED" | "FAILED"
          selected_statuses: Array<"PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED">
          appointments_deleted: number
          notification_events_deleted: number
          admin_notifications_deleted: number
          error_code: string | null
        }[]
      }
      admin_count_availability_notifications: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      admin_cleanup_availability_notifications: {
        Args: Record<PropertyKey, never>
        Returns: {
          operation_id: string
          operation_status: "RUNNING" | "SUCCEEDED" | "FAILED"
          notifications_deleted: number
          error_code: string | null
        }[]
      }
      create_availability_slots: {
        Args: {
          p_barber_id: string
          p_slot_dates: string[]
          p_start_time: string
          p_end_time?: string | null
        }
        Returns: {
          id: string
          barber_id: string
          slot_date: string
          start_time: string
          end_time: string
          status: "AVAILABLE" | "UNAVAILABLE"
          internal_note: string | null
          created_at: string
          updated_at: string
          updated_by: string | null
        }[]
      }
      read_valid_availability_starts: {
        Args: {
          p_barber_id?: string | null
          p_from_date?: string | null
          p_to_date?: string | null
        }
        Returns: {
          barber_id: string
          slot_date: string
          start_time: string
          is_exception: boolean
          compatible_services: string[]
        }[]
      }
      update_availability_slot: {
        Args: {
          p_slot_id: string
          p_status: "AVAILABLE" | "UNAVAILABLE"
          p_internal_note: string | null
        }
        Returns: {
          id: string
          barber_id: string
          slot_date: string
          start_time: string
          end_time: string
          status: "AVAILABLE" | "UNAVAILABLE"
          internal_note: string | null
          created_at: string
          updated_at: string
          updated_by: string | null
        }[]
      }
    }
    Enums: {
      appointment_status: "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED"
      notification_type: "NEW_REQUEST" | "CONFIRMED" | "CANCELLED"
      notification_delivery_status: "PENDING" | "SENDING" | "SENT" | "FAILED"
      admin_activity_event_type: "AVAILABILITY_UNAVAILABLE" | "AVAILABILITY_AVAILABLE" | "APPOINTMENT_REQUESTED" | "APPOINTMENT_CONFIRMED" | "APPOINTMENT_CANCELLED"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
