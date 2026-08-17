import Link from 'next/link';
import { CATEGORY_DIRECTORY } from '@/lib/categories';

export function CategoryDirectory({ activeCategory }: { activeCategory?: string }) {
  return (
    <section className="category-section section-shell" aria-labelledby="category-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Four reference categories</p>
          <h2 id="category-heading">Start with the job to be done.</h2>
        </div>
        <p>
          Categories come from valid self-declared metadata. They improve discovery, not trust or
          authority.
        </p>
      </div>
      <div className="category-grid">
        {CATEGORY_DIRECTORY.map((category) => {
          const active = category.id === activeCategory;
          return (
            <Link
              className={`category-card${active ? ' category-card-active' : ''}`}
              href={`/?category=${category.id}#marketplace`}
              aria-current={active ? 'page' : undefined}
              key={category.id}
            >
              <span className="category-code" aria-hidden="true">
                {category.code}
              </span>
              <div>
                <h3>{category.label}</h3>
                <p>{category.description}</p>
              </div>
              <span className="category-arrow" aria-hidden="true">
                ↗
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
