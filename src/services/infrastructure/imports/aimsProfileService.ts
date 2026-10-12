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
  // Metadata responses omit the definition. Download the raw RDF directly,
  // preserving the full profile IRI (including trailing slashes and versions).
  const url = `${AIMS_API}/RawRDF/${encodeURIComponent(profile.base_url)}`
  const response = await fetch(url, {
    headers: {
      Accept: 'text/turtle',
    },
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`AIMS profile load failed: ${response.status}`)
  }

  const turtle = await response.text()
  if (!turtle.trim()) {
    throw new Error('AIMS profile load failed: empty Turtle response')
  }
  return turtle
}

