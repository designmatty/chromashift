import { Badge, Button } from '@chakra-ui/react'
import { Palette, Plus } from 'lucide-react'
import type { ColorProfile } from '@chromashift/core'

const DEFAULT_ID = 'default'

export function ProfileList({
  profiles,
  selectedId,
  onSelect,
  onCreate
}: {
  profiles: ColorProfile[]
  selectedId: string | null
  onSelect(profile: ColorProfile): void
  onCreate(): void
}): React.JSX.Element {
  return (
    <section className="profile-list">
      <header>
        <strong>Profiles</strong>
        <Badge colorPalette="brand" variant="subtle">
          {profiles.length}
        </Badge>
      </header>
      <div className="profile-items">
        {profiles.map((profile) => (
          <button
            className={profile.id === selectedId ? 'profile-item selected' : 'profile-item'}
            key={profile.id}
            onClick={() => onSelect(profile)}
          >
            <span className="profile-icon">
              <Palette />
            </span>
            <span>
              <strong>{profile.name}</strong>
              <small>
                {profile.id === DEFAULT_ID
                  ? 'Global profile'
                  : `${profile.applications.length} application${profile.applications.length === 1 ? '' : 's'}`}
              </small>
            </span>
            {!profile.enabled && <Badge variant="outline">Off</Badge>}
          </button>
        ))}
      </div>
      <Button colorPalette="brand" size="sm" variant="outline" onClick={onCreate}>
        <Plus />
        New profile
      </Button>
    </section>
  )
}
