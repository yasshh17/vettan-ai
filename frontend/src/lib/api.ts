
import axios from 'axios'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export interface ResearchRequest {
  query: string
  max_iterations?: number
  use_cache?: boolean
}

export interface ResearchResponse {
  output: string
  citations: Array<{
    domain: string
    url: string
  }>
  metadata: {
    iterations: number
    estimated_cost: number
    from_cache: boolean
  }
}

export const api = {
  research: async (request: ResearchRequest): Promise<ResearchResponse> => {
    const response = await axios.post(`${API_BASE_URL}/api/research`, request)
    return response.data
  },
  
  getHistory: async () => {
    const response = await axios.get(`${API_BASE_URL}/api/history`)
    return response.data.sessions
  }
}
