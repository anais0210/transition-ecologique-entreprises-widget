import type { ProgramData } from '@tee/web/src/types/program/programTypes'
import Engine from 'publicodes'
import { Result } from 'true-myth'
import type { PublicodesInputData, QuestionnaireData } from './types'
import type { CurrentDateService } from './spi'
import { ensureError } from '../../common/domain/error/errors'
import { filterObject } from '../../common/objects'
import { preprocessInputForPublicodes } from './preprocessProgram'

/** Expected rule to evaluate if a program should be displayed to the user or
 * filtered out (in a program's `publicodes`
 * property).
 *  @constant
 *  @default
 */
export const FILTERING_RULE_NAME: string = 'entreprise . est ciblée'

/** deals with dependency injection */
export const createService = (currentDateService: CurrentDateService) => {
  /** Filter out programs for which the company is not eligible
   *
   * @param programs - A list of programs, holding data on their filtering
   *   rules (inside the `publicodes` property)
   * @param inputData - Data associated with the company or the user inputs.
   * @returns Programs from `programs` that are either eligible (rules evaluate
   *   to `true`) or which eligibility cannot be assessed (rules evaluate to
   *   `undefined`, for instance with missing data)
   */
  const filterPrograms = (programs: ProgramData[], inputData: QuestionnaireData): Result<ProgramData[], Error> => {
    const filteredPrograms: ProgramData[] = []

    for (const program of programs) {
      const evaluation = evaluateRule(program, inputData, currentDateService.get())

      if (evaluation.isErr) {
        return Result.err(addErrorDetails(evaluation.error, program.id))
      }

      if (shouldKeepProgram(evaluation)) {
        filteredPrograms.push(program)
      }
    }

    return Result.ok(filteredPrograms)
  }

  return filterPrograms
}

const shouldKeepProgram = (evaluation: Result<boolean | undefined, Error>): boolean => {
  const isPositive = evaluation.isOk && evaluation.value
  const isUndefined = evaluation.isOk && typeof evaluation.value === 'undefined'

  return isPositive || isUndefined
}

/** Evaluates given program specific rules and user specific input data, if
 * the program should be displayed to the user.
 *
 * @param rules - An object encoding Publicode rules for a given program. The
 *   constant `FILTERING_RULE_NAME` determines which rule to evaluate, which is therefore
 *   mandatory.
 * @param questionnaireData - Data associated with the company or the user inputs. The
 *   data is expected to be using the exact same names as the variables in the
 *   `rules`.
 *
 * @returns Result that stores the rule evaluation (either a boolean or
 *   `undefined` if the input data does not allow to fully evaluate the rule) or
 *   the Error if any.
 */
const evaluateRule = (
  programData: ProgramData,
  questionnaireData: QuestionnaireData,
  currentDate: string
): Result<boolean | undefined, Error> => {
  const rules = programData.publicodes as object

  let engine: Engine
  try {
    engine = new Engine(rules)
  } catch (e) {
    const err = ensureError(e)
    return Result.err(err)
  }

  const preprocessedData = preprocessInputForPublicodes(questionnaireData, programData, currentDate)

  const narrowedData = narrowInput(preprocessedData, engine)

  engine.setSituation(narrowedData)

  const evaluation = engine.evaluate(FILTERING_RULE_NAME)
  const eligibility = evaluation.nodeValue

  if (typeof eligibility !== 'boolean' && typeof eligibility !== 'undefined') {
    return Result.err(new Error(`"${FILTERING_RULE_NAME}" is expected to be a boolean or undefined`))
  }
  return Result.ok(eligibility)
}

/** Narrows input data to keep only keys expected inside the rules
 */
const narrowInput = (data: PublicodesInputData, engine: Engine): Partial<PublicodesInputData> => {
  const parsedRules = engine.getParsedRules()

  const allowed = Object.keys(parsedRules)

  return filterObject(data, (entry) => allowed.includes(entry[0]))
}

const addErrorDetails = (err: Error, programName: string): Error => {
  return new Error(`Evaluation of publicodes rules failed on program with id ${programName}`, {
    cause: err
  })
}
