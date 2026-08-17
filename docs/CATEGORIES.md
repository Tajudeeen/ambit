# Agent Categories (M11)

M11 implements the four reference marketplace categories as a deterministic,
versioned classification layer over valid ERC-8004 registration metadata:

- `monitoring`
- `grid-trading`
- `health-factor`
- `yield`

Category is a discovery label, not a trust signal, execution permission, or
visibility gate. An agent with no supported signal or conflicting category
signals remains discoverable with `category: null`.

## Input boundary

The classifier accepts only a registration file that already passed the M2
ERC-8004 metadata validator. It considers:

1. structured service names;
2. string-valued service skills and domains; then
3. the registration name and description.

Arbitrary nested objects, endpoint hostnames, owner addresses, reputation text,
and model-generated interpretation are not category inputs. Malformed metadata
can still provide a display name through the existing lenient path, but it cannot
produce a category claim.

## Deterministic resolution

Each category owns a closed, reviewed alias list. Inputs are lowercased,
Unicode-normalized, and split on punctuation before whole-phrase matching.

Structured service signals have precedence over name/description signals:

- exactly one structured category match selects that category;
- multiple structured category matches return `null` as ambiguous;
- when no structured category matches, exactly one text category match selects
  that category; and
- zero or multiple text matches return `null`.

The classifier never uses ordering to break a tie. Alias changes require a
classifier version change and tests for positive, negative, and ambiguous cases.

## Provenance

A selected category appends `metadata-category-classification` evidence with the
classifier version and indexing timestamp. An ambiguous result appends
`metadata-category-ambiguous` evidence while leaving the category unset. Unknown
metadata adds no derived category evidence.

Category evidence does not add trust points. The trust engine continues to score
identity, metadata validity, endpoint, activity, reputation, payment, and
execution evidence under its own methodology.

## Marketplace presentation

The M10 marketplace gains four category entry points that apply explicit URL
filters. They contain descriptive product copy but no hardcoded agents, counts,
scores, or execution claims. Search still defaults to all indexed agents.
