import { MAX_OPS_PER_MUTATION, type ProjectModel } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'

/**
 * 테스트용: 삭제 op 총수가 한 요청의 상한(MAX_OPS_PER_MUTATION)을 넘는 모델. 테이블 수는 그대로 두고 컬럼만 붙인다.
 *
 * 여기 두는 이유: 일괄 삭제 확인 창(`BulkDeleteDialog`)을 **툴바와 일괄 패널이 공유**하고, 두 진입점의 테스트가
 * 「상한을 넘어도 조각으로 나뉘어 간다」를 같은 픽스처로 봐야 한쪽만 옛 가드로 돌아가도 잡힌다.
 */
export function modelOverOpCap(): ProjectModel {
  const m = buildSampleModel()
  for (let i = 0; i < MAX_OPS_PER_MUTATION; i++) {
    const id = `bulk-c${i}`
    m.columns[id] = {
      id, tableId: 't1', logicalName: `컬럼${i}`, physicalName: `COL_${i}`,
      type: 'VARCHAR(10)', isPk: false, autoIncrement: false, nullable: true,
      defaultValue: null, order: i + 1, comment: null, domainId: null, custom: {},
    }
  }
  return m
}
