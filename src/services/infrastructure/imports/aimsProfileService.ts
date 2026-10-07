const AIMS_API = 'https://aims-backend.tools.coscine.dev/AIMS/application-profiles'

export interface AimsProfile {
  name: string
  base_url: string
  description?: string
  creator?: string
  state?: string | number
  created?: string
  mimeType?: string
}

export async function loadAimsProfiles(): Promise<AimsProfile[]> {
  const url = new URL(AIMS_API)
  url.searchParams.set('state', 'public')
  url.searchParams.set('includeDefinition', 'false')

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`AIMS profile search failed: ${response.status}`)
  }

  const data = await response.json()
  const profiles: AimsProfile[] = Array.isArray(data)
    ? data
    : Array.isArray(data.value)
      ? data.value
      : []

  return profiles.sort((left, right) => left.name.localeCompare(right.name))
}

export async function fetchAimsProfileTurtle(profile: AimsProfile): Promise<string> {
  const response = await fetch(profile.base_url, {
    headers: {
      Accept: 'text/turtle, application/x-turtle, text/plain, */*',
    },
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`AIMS profile load failed: ${response.status}`)
  }

  return await response.text()
}

