/** Who is performing an action; passed from controllers into services for auditing. */
export interface Actor { id: string; name: string; ip?: string; role?: string }
