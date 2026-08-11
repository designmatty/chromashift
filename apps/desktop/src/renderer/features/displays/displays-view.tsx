import { Badge, Separator } from '@chakra-ui/react'
import { Monitor } from 'lucide-react'
import { formatName } from '@/lib/product-result'
import type { ProductState } from '../../../shared/product-api.js'

export function DisplaysView({ product }: { product: ProductState }): React.JSX.Element {
  return (
    <section className="displays-page">
      <header>
        <h1>Displays</h1>
        <p>Connected hardware and resolved provider capabilities.</p>
      </header>
      <div className="display-grid">
        {product.displays.map((display) => (
          <article key={display.id}>
            <div className="display-title">
              <Monitor />
              <div>
                <h2>{display.name}</h2>
                <p>{display.adapter.name}</p>
              </div>
              {display.primary && (
                <Badge colorPalette="brand" variant="subtle">
                  Primary
                </Badge>
              )}
            </div>
            <dl>
              <dt>Connection</dt>
              <dd>{display.connection}</dd>
              <dt>HDR</dt>
              <dd>{display.hdr ? 'On' : 'Off'}</dd>
              <dt>Refresh rate</dt>
              <dd>{display.refreshRate} Hz</dd>
            </dl>
            <Separator />
            <div className="capabilities">
              {Object.entries(product.capabilityReports[display.id]?.capabilities ?? {}).map(
                ([name, capability]) => (
                  <div key={name}>
                    <span>{formatName(name)}</span>
                    <Badge variant={capability.supported ? 'subtle' : 'outline'}>
                      {capability.supported ? capability.provider : 'Unavailable'}
                    </Badge>
                  </div>
                )
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
